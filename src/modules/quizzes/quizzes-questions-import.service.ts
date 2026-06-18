import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { apiResponse } from '../../common/utils/api-response';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { QuizzesCacheService } from './utils/quizzes-cache.service';
import { QUIZZES_INVALIDATE_PATTERN } from './utils/quizzes-cache';
import { sanitizeTiptapHtmlServer } from './utils/sanitize-html-server';
import { nowSec } from './quizzes-mutations.service';
import { QuizzesQuestionsService } from './quizzes-questions.service';
import {
    MATCH_OPTION_COUNT,
    QuestionsExcelTemplateBuilder,
    type ImportQuestionType,
    type ParsedQuestionRow,
} from './utils/questions-excel-template';

/**
 * Phase 26 — bulk import of quiz questions from an Excel workbook.
 *
 * Purely ADDITIVE (mirrors createQuestion): no quiz version bump, no
 * force-confirm gate. PARTIAL SUCCESS is the contract — each question is created
 * in its OWN prisma.$transaction; one failing question rolls back only itself and
 * is reported, the rest still import.
 *
 * For identificative (ENT) questions we inline the two-phase create (prompts
 * first so they get the smaller ids the editor expects, then the 4 shared
 * options, then wire each prompt's match_target_id) — we deliberately do NOT
 * reuse QuizzesAnswersService.createAnswer (it opens its own tx + invalidates
 * cache per call).
 */

const TITLE_MAX = 2000;
const DESC_MAX = 50000;
const DESCRIPTIVE_CORRECT_MAX = 5000;
const ANSWER_TITLE_MAX = 1000;

export interface QuestionImportRow {
    sheet: string;
    row: number;
    type: ImportQuestionType;
    title: string;
    status: 'ok' | 'error';
    reason: string | null;
    question_id: number | null;
}

export interface QuestionImportResult {
    total: number;
    succeeded: number;
    failed: number;
    imported_answers: number;
    rows: QuestionImportRow[];
}

interface PreparedSingleMultiple {
    grade: number;
    title: string;
    description: string | null;
    /** Non-empty variants with their 1-based column position. */
    options: { position: number; text: string }[];
    /** Column positions (1-based) marked correct. */
    correctPositions: Set<number>;
}

interface PreparedDescriptive {
    grade: number;
    title: string;
    description: string | null;
    correctText: string;
}

interface PreparedMatching {
    grade: number;
    title: string;
    description: string | null;
    prompts: [string, string];
    options: [string, string, string, string];
    /** 1-based option index (1..4) each prompt maps to. */
    correct: [number, number];
}

type Prepared = PreparedSingleMultiple | PreparedDescriptive | PreparedMatching;

@Injectable()
export class QuizzesQuestionsImportService {
    private readonly logger = new Logger(QuizzesQuestionsImportService.name);
    private readonly builder = new QuestionsExcelTemplateBuilder();

    constructor(
        private readonly prisma: PrismaService,
        private readonly cache: QuizzesCacheService,
        private readonly questionsService: QuizzesQuestionsService,
    ) {}

    public buildTemplate(): Promise<Buffer> {
        return this.builder.buildTemplate();
    }

    public async importFromBuffer(actor: ScopeActor, quizId: number, buf: Buffer) {
        await this.questionsService.assertQuizScope(actor, quizId);
        if (actor.role_name === 'curator') {
            throw new ForbiddenException(apiResponse(0, 'forbidden_scope', 'quizzes.forbidden_scope'));
        }

        const parsed = await this.builder.parse(buf);
        const rows: QuestionImportRow[] = [];
        let succeeded = 0;
        let failed = 0;
        let importedAnswers = 0;

        // Compute the starting order ONCE; increment locally per inserted question.
        // Benign duplicate-order race vs a concurrent manual create is acceptable —
        // `order` has no unique constraint and list ties break by id.
        const last: any = await this.prisma.quizQuestion.findFirst({
            where: { quiz_id: quizId },
            orderBy: [{ order: 'desc' }, { id: 'desc' }],
            select: { order: true },
        });
        let nextOrder = last && last.order != null ? Number(last.order) + 1 : 1;

        for (const pq of parsed) {
            const validation = this.validate(pq);
            const displayTitle = validation.prepared?.title ?? pq.title ?? '';
            if (validation.reason) {
                rows.push({ sheet: pq.sheet, row: pq.row, type: pq.type, title: displayTitle, status: 'error', reason: validation.reason, question_id: null });
                failed++;
                continue;
            }

            try {
                const created = await this.persist(quizId, pq.type, validation.prepared!, nextOrder);
                rows.push({ sheet: pq.sheet, row: pq.row, type: pq.type, title: displayTitle, status: 'ok', reason: null, question_id: created.questionId });
                succeeded++;
                importedAnswers += created.answersCreated;
                nextOrder++;
            } catch (e) {
                this.logger.warn(`question import row failed sheet="${pq.sheet}" row=${pq.row} err=${(e as Error).message}`);
                rows.push({ sheet: pq.sheet, row: pq.row, type: pq.type, title: displayTitle, status: 'error', reason: 'db_error', question_id: null });
                failed++;
            }
        }

        if (succeeded > 0) {
            await this.cache.invalidate(QUIZZES_INVALIDATE_PATTERN);
        }

        const result: QuestionImportResult = {
            total: parsed.length,
            succeeded,
            failed,
            imported_answers: importedAnswers,
            rows,
        };
        this.logger.log(
            `questions import quiz=${quizId} actor=${actor.id} role=${actor.role_name} total=${result.total} ok=${succeeded} failed=${failed}`,
        );
        return apiResponse(1, 'ok', 'quizzes.question.import', result);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Validation (in-memory; no DB)
    // ──────────────────────────────────────────────────────────────────────────

    private validate(pq: ParsedQuestionRow): { reason: string | null; prepared?: Prepared } {
        const gradeReason = this.validateGrade(pq);
        if (gradeReason) return { reason: gradeReason };
        const grade = pq.grade as number;

        if (!pq.title) return { reason: 'question_empty' };
        if (pq.title.length > TITLE_MAX) return { reason: 'title_too_long' };
        if (pq.description && pq.description.length > DESC_MAX) return { reason: 'description_too_long' };

        if (pq.type === 'single' || pq.type === 'multiple') {
            return this.validateChoice(pq, grade);
        }
        if (pq.type === 'descriptive') {
            if (!pq.correctText) return { reason: 'descriptive_answer_required' };
            if (pq.correctText.length > DESCRIPTIVE_CORRECT_MAX) return { reason: 'descriptive_answer_too_long' };
            return { reason: null, prepared: { grade, title: pq.title, description: pq.description, correctText: pq.correctText } };
        }
        return this.validateMatching(pq, grade);
    }

    private validateGrade(pq: ParsedQuestionRow): string | null {
        if (!pq.gradeRaw) return 'grade_required';
        if (pq.grade == null || pq.grade < 1) return 'grade_not_int';
        return null;
    }

    private validateChoice(pq: ParsedQuestionRow, grade: number): { reason: string | null; prepared?: Prepared } {
        const options: { position: number; text: string }[] = [];
        for (let i = 0; i < pq.options.length; i++) {
            const text = pq.options[i];
            if (text == null) continue;
            if (text.length > ANSWER_TITLE_MAX) return { reason: 'option_too_long' };
            options.push({ position: i + 1, text });
        }
        if (options.length < 2) return { reason: 'no_variants' };

        if (!pq.correctRaw) return { reason: 'correct_required' };
        const indexes = parseIndexList(pq.correctRaw);
        if (indexes == null) return { reason: 'correct_index_out_of_range' };

        const validPositions = new Set(options.map((o) => o.position));
        for (const idx of indexes) {
            if (!validPositions.has(idx)) return { reason: 'correct_index_out_of_range' };
        }

        if (pq.type === 'single') {
            if (indexes.length !== 1) return { reason: 'single_multiple_correct' };
        } else {
            if (indexes.length < 1) return { reason: 'multiple_no_correct' };
        }

        return {
            reason: null,
            prepared: { grade, title: pq.title!, description: pq.description, options, correctPositions: new Set(indexes) },
        };
    }

    private validateMatching(pq: ParsedQuestionRow, grade: number): { reason: string | null; prepared?: Prepared } {
        for (const p of pq.prompts) {
            if (!p) return { reason: 'matching_prompt_required' };
            if (p.length > ANSWER_TITLE_MAX) return { reason: 'option_too_long' };
        }
        if (pq.matchOptions.length < MATCH_OPTION_COUNT) return { reason: 'matching_option_required' };
        for (const o of pq.matchOptions) {
            if (!o) return { reason: 'matching_option_required' };
            if (o.length > ANSWER_TITLE_MAX) return { reason: 'option_too_long' };
        }

        const correct: number[] = [];
        for (const raw of pq.matchCorrectRaw) {
            const n = raw == null ? NaN : Number(raw);
            if (!Number.isInteger(n) || n < 1 || n > MATCH_OPTION_COUNT) return { reason: 'matching_correct_invalid' };
            correct.push(n);
        }

        return {
            reason: null,
            prepared: {
                grade,
                title: pq.title!,
                description: pq.description,
                prompts: [pq.prompts[0]!, pq.prompts[1]!],
                options: [pq.matchOptions[0]!, pq.matchOptions[1]!, pq.matchOptions[2]!, pq.matchOptions[3]!],
                correct: [correct[0], correct[1]],
            },
        };
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Persistence — one transaction per question (partial-success granularity)
    // ──────────────────────────────────────────────────────────────────────────

    private async persist(
        quizId: number,
        type: ImportQuestionType,
        prepared: Prepared,
        order: number,
    ): Promise<{ questionId: number; answersCreated: number }> {
        return this.prisma.$transaction(async (tx) => {
            const now = nowSec();
            const correctText = type === 'descriptive' ? (prepared as PreparedDescriptive).correctText : null;

            const question: any = await tx.quizQuestion.create({
                data: { quiz_id: quizId, type, grade: prepared.grade, order, created_at: now },
                select: { id: true },
            });
            await tx.quizQuestionTranslation.create({
                data: {
                    quizzes_question_id: question.id,
                    locale: 'kz',
                    title: prepared.title,
                    description: toTiptapHtml(prepared.description),
                    correct: correctText,
                },
            });

            let answersCreated = 0;

            if (type === 'single' || type === 'multiple') {
                const p = prepared as PreparedSingleMultiple;
                for (const opt of p.options) {
                    await this.createAnswerRow(tx, question.id, opt.text, {
                        correct: p.correctPositions.has(opt.position),
                        now,
                    });
                    answersCreated++;
                }
            } else if (type === 'identificative') {
                const p = prepared as PreparedMatching;
                // Prompts FIRST (smaller ids → editor renders them as the 2 prompt slots).
                const promptIds: number[] = [];
                for (const promptText of p.prompts) {
                    const id = await this.createAnswerRow(tx, question.id, promptText, { correct: false, now });
                    promptIds.push(id);
                }
                // 4 shared options next.
                const optionIds: number[] = [];
                for (const optionText of p.options) {
                    const id = await this.createAnswerRow(tx, question.id, optionText, { correct: false, now });
                    optionIds.push(id);
                }
                answersCreated = promptIds.length + optionIds.length;
                // Wire each prompt's match_target_id to its correct option.
                for (let i = 0; i < promptIds.length; i++) {
                    await tx.quizQuestionAnswer.update({
                        where: { id: promptIds[i] },
                        data: { match_target_id: optionIds[p.correct[i] - 1] },
                    });
                }
            }
            // descriptive: no answer rows.

            return { questionId: Number(question.id), answersCreated };
        });
    }

    private async createAnswerRow(
        tx: any,
        questionId: number,
        title: string,
        opts: { correct: boolean; now: number },
    ): Promise<number> {
        const answer: any = await tx.quizQuestionAnswer.create({
            data: {
                question_id: questionId,
                parent_id: null,
                match_target_id: null,
                correct: opts.correct,
                created_at: opts.now,
            },
            select: { id: true },
        });
        await tx.quizQuestionAnswerTranslation.create({
            data: { quizzes_questions_answer_id: answer.id, locale: 'kz', title },
        });
        return Number(answer.id);
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Parse a "correct index(es)" cell into 1-based positions. Accepts `;` `,` and
 * whitespace as separators. Returns null if any token is not a positive integer.
 */
function parseIndexList(raw: string): number[] | null {
    const tokens = raw
        .split(/[;,\s]+/)
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
    if (tokens.length === 0) return null;
    const out = new Set<number>();
    for (const tok of tokens) {
        const n = Number(tok);
        if (!Number.isInteger(n) || n < 1) return null;
        out.add(n);
    }
    return Array.from(out);
}

/** Wrap plain Excel text as a sanitized Tiptap paragraph. */
function toTiptapHtml(text: string | null): string | null {
    if (!text) return null;
    const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return sanitizeTiptapHtmlServer(`<p>${escaped}</p>`);
}
