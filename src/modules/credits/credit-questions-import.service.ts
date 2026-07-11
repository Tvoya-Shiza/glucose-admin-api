import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { apiResponse } from '../../common/utils/api-response';
import type { ScopeActor } from '../../common/scoping/scope.types';
import type { CreditDifficulty } from '@shared/credits';
import { sanitizeTiptapHtmlServer } from '../courses/utils/sanitize-html-server';
import { CreditQuestionsService } from './credit-questions.service';
import { CreditQuestionsExcelTemplateBuilder, type ParsedCreditQuestionRow } from './utils/credit-questions-excel-template';
import { nowSec } from './utils/time';

/**
 * Bulk import of credit («зачёт») bank questions from an Excel workbook (item 1),
 * mirroring the quiz importer (Phase 26). Purely additive; PARTIAL SUCCESS is the
 * contract — each row is created on its own, one failing row is reported and the
 * rest still import.
 *
 * The whole batch is tagged to ONE topic/lesson (chosen in the dialog): the target
 * credit_topics.id is resolved once via CreditQuestionsService.resolveTargetTopicId
 * (materializing a lesson-topic lazily when a lesson is chosen).
 */

const TEXT_MAX = 50000;

export interface CreditQuestionImportRow {
    row: number;
    status: 'ok' | 'error';
    reason: string | null;
    question_id: string | null;
}

export interface CreditQuestionImportResult {
    total: number;
    succeeded: number;
    failed: number;
    rows: CreditQuestionImportRow[];
}

interface PreparedRow {
    difficulty: CreditDifficulty;
    question: string;
    answer: string;
    score: number;
}

@Injectable()
export class CreditQuestionsImportService {
    private readonly logger = new Logger(CreditQuestionsImportService.name);
    private readonly builder = new CreditQuestionsExcelTemplateBuilder();

    constructor(
        private readonly prisma: PrismaService,
        private readonly questionsService: CreditQuestionsService,
    ) {}

    public buildTemplate(): Promise<Buffer> {
        return this.builder.buildTemplate();
    }

    public async importFromBuffer(
        actor: ScopeActor,
        target: { topic_id?: string; chapter_item_id?: number },
        buf: Buffer,
    ) {
        // Resolve (and lazily materialize) the batch's target topic ONCE — a bad
        // target throws here before any row is inserted.
        const topicId = await this.questionsService.resolveTargetTopicId(actor, target.topic_id, target.chapter_item_id);

        const parsed = await this.builder.parse(buf);
        const rows: CreditQuestionImportRow[] = [];
        let succeeded = 0;
        let failed = 0;
        const now = nowSec();

        for (const pr of parsed) {
            const validation = this.validate(pr);
            if (validation.reason) {
                rows.push({ row: pr.row, status: 'error', reason: validation.reason, question_id: null });
                failed++;
                continue;
            }
            const prepared = validation.prepared!;
            try {
                const created = await this.prisma.creditQuestion.create({
                    data: {
                        topic_id: topicId,
                        difficulty: prepared.difficulty,
                        question: prepared.question,
                        answer: prepared.answer,
                        score: prepared.score,
                        created_by: actor.id,
                        created_at: now,
                    },
                    select: { id: true },
                });
                rows.push({ row: pr.row, status: 'ok', reason: null, question_id: created.id.toString() });
                succeeded++;
            } catch (e) {
                this.logger.warn(`credit question import row failed row=${pr.row} err=${(e as Error).message}`);
                rows.push({ row: pr.row, status: 'error', reason: 'db_error', question_id: null });
                failed++;
            }
        }

        const result: CreditQuestionImportResult = { total: parsed.length, succeeded, failed, rows };
        this.logger.log(
            `credit-questions import actor=${actor.id} role=${actor.role_name} topic=${topicId.toString()} total=${result.total} ok=${succeeded} failed=${failed}`,
        );
        return apiResponse(1, 'ok', 'admin.credits.questions_imported', result);
    }

    // -------------------------------------------------------------- validation

    private validate(pr: ParsedCreditQuestionRow): { reason: string | null; prepared?: PreparedRow } {
        if (!pr.difficultyRaw) return { reason: 'difficulty_required' };
        if (pr.difficultyRaw !== 'A' && pr.difficultyRaw !== 'B' && pr.difficultyRaw !== 'C') {
            return { reason: 'difficulty_invalid' };
        }
        if (!pr.question) return { reason: 'question_empty' };
        if (pr.question.length > TEXT_MAX) return { reason: 'question_too_long' };
        if (!pr.answer) return { reason: 'answer_empty' };
        if (pr.answer.length > TEXT_MAX) return { reason: 'answer_too_long' };
        // score: empty → 1; present must be a positive integer.
        let score = 1;
        if (pr.scoreRaw) {
            if (pr.score == null || pr.score < 1) return { reason: 'score_not_int' };
            score = pr.score;
        }
        return {
            reason: null,
            prepared: {
                difficulty: pr.difficultyRaw as CreditDifficulty,
                question: toTiptapHtml(pr.question),
                answer: toTiptapHtml(pr.answer),
                score,
            },
        };
    }
}

/** Wrap plain Excel text as a sanitized Tiptap paragraph (imported text is plain). */
function toTiptapHtml(text: string): string {
    const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return sanitizeTiptapHtmlServer(`<p>${escaped}</p>`);
}
