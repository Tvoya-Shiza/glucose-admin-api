import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { apiResponse } from '../../common/utils/api-response';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { QuizzesCacheService } from './utils/quizzes-cache.service';
import { QUIZZES_INVALIDATE_PATTERN } from './utils/quizzes-cache';
import { nowSec, readQuizDetail } from './quizzes-mutations.service';

/**
 * QZ-07 — POST /admin-api/v1/admin/quizzes/:id/duplicate (Plan 02).
 *
 * Single $transaction deep copy of one quiz with all children:
 *   - Quizzes row (new id, version=1, fresh created_at)
 *   - QuizTranslation rows (one per source translation)
 *   - QuizQuestion rows (new ids; same quiz_id mapping)
 *     - QuizQuestionTranslation rows
 *     - QuizQuestionAnswer rows (TWO-PASS for identificative parent_id remap):
 *       Pass A: rows where source.parent_id IS NULL (LEFT-side / non-identificative)
 *       Pass B: rows where source.parent_id IS NOT NULL (RIGHT-side identificative);
 *               parent_id remapped via answerIdMap[old -> new]; orphan parents -> null
 *               (graceful — recorded in payload's `orphan_remaps` count for audit meta).
 *       - QuizQuestionAnswerTranslation rows
 *   - QuizBadgeItem associations are NOT copied (a duplicate quiz starts un-assigned;
 *     admin re-adds via Plan 06 if desired). Documented in plan; T-06-21 covers
 *     pre-existing source-graph corruption.
 *
 * Returns the FULL QuizDetailDto for the new quiz, plus duplicate-specific meta
 * (source_quiz_id, new_quiz_id, questions_copied, answers_copied, orphan_remaps)
 * which AuditInterceptor reads via the response shape (`response.data.id` resolves
 * `entity_id`, the rest of the payload is observable in NDJSON if logged downstream).
 *
 * Scope:
 *   - admin / teacher pass (D-21).
 *   - curator -> 403 quizzes.forbidden_scope (defensive — controller @Roles excludes).
 *
 * Performance: T-06-18 acceptance — single tx, MySQL row locks for ≤ several seconds
 * on a 200-question / 2000-answer source. Acceptable given admin-only operation.
 */
@Injectable()
export class QuizzesDuplicateService {
    private readonly logger = new Logger(QuizzesDuplicateService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly cache: QuizzesCacheService,
    ) {}

    public async duplicate(actor: ScopeActor, sourceId: number) {
        if (actor.role_name === 'curator') {
            throw new ForbiddenException('quizzes.forbidden_scope');
        }

        // Load source with full graph BEFORE the tx so we can 404 cleanly without
        // tx rollback.
        const source: any = await this.prisma.quizzes.findUnique({
            where: { id: sourceId },
            select: {
                id: true,
                status: true,
                category_id: true,
                subject_id: true,
                time: true,
                pass_mark: true,
                attempt: true,
                certificate: true,
                display_questions_randomly: true,
                expiry_days: true,
                translations: { select: { locale: true, title: true } },
                questions: {
                    orderBy: [{ order: 'asc' }, { id: 'asc' }],
                    select: {
                        id: true,
                        type: true,
                        grade: true,
                        image: true,
                        video: true,
                        answer_video_url: true,
                        order: true,
                        translations: {
                            select: { locale: true, title: true, description: true, correct: true },
                        },
                        answers: {
                            orderBy: { id: 'asc' },
                            select: {
                                id: true,
                                parent_id: true,
                                image: true,
                                correct: true,
                                translations: { select: { locale: true, title: true } },
                            },
                        },
                    },
                },
            },
        });
        if (!source) throw new NotFoundException('quizzes.not_found');

        const now = nowSec();
        let questions_copied = 0;
        let answers_copied = 0;
        let orphan_remaps = 0;

        const newQuizId: number = await this.prisma.$transaction(async (tx) => {
            // 1. Create the new quiz row.
            const newQuiz: any = await tx.quizzes.create({
                data: {
                    status: source.status,
                    category_id: source.category_id ?? null,
                    subject_id: source.subject_id ?? null,
                    time: source.time ?? 0,
                    pass_mark: source.pass_mark,
                    attempt: source.attempt ?? null,
                    certificate: !!source.certificate,
                    display_questions_randomly: !!source.display_questions_randomly,
                    expiry_days: source.expiry_days ?? null,
                    version: 1,
                    created_at: now,
                },
                select: { id: true },
            });

            // 2. Copy quiz translations.
            if ((source.translations ?? []).length > 0) {
                await tx.quizTranslation.createMany({
                    data: source.translations.map((t: any) => ({
                        quiz_id: newQuiz.id,
                        locale: t.locale,
                        title: t.title,
                    })),
                });
            }

            // 3. For each source question: create question, copy translations, two-pass copy answers.
            for (const sq of (source.questions ?? []) as any[]) {
                const newQ: any = await tx.quizQuestion.create({
                    data: {
                        quiz_id: newQuiz.id,
                        type: sq.type,
                        grade: sq.grade,
                        image: sq.image ?? null,
                        video: sq.video ?? null,
                        answer_video_url: sq.answer_video_url ?? null,
                        order: sq.order ?? null,
                        created_at: now,
                    },
                    select: { id: true },
                });
                questions_copied++;

                // Question translations.
                for (const qt of (sq.translations ?? []) as any[]) {
                    await tx.quizQuestionTranslation.create({
                        data: {
                            quizzes_question_id: newQ.id,
                            locale: qt.locale,
                            title: qt.title,
                            description: qt.description ?? null,
                            correct: qt.correct ?? null,
                        },
                    });
                }

                // Two-pass answer copy with parent_id remap.
                const sourceAnswers: any[] = (sq.answers ?? []) as any[];
                const answerIdMap = new Map<number, number>();

                // Pass A: parent_id IS NULL (LEFT-side or non-identificative).
                for (const sa of sourceAnswers) {
                    if (sa.parent_id != null) continue;
                    const newA: any = await tx.quizQuestionAnswer.create({
                        data: {
                            question_id: newQ.id,
                            parent_id: null,
                            image: sa.image ?? null,
                            correct: !!sa.correct,
                            created_at: now,
                        },
                        select: { id: true },
                    });
                    answerIdMap.set(Number(sa.id), Number(newA.id));
                    answers_copied++;

                    for (const at of (sa.translations ?? []) as any[]) {
                        await tx.quizQuestionAnswerTranslation.create({
                            data: {
                                quizzes_questions_answer_id: newA.id,
                                locale: at.locale,
                                title: at.title,
                            },
                        });
                    }
                }

                // Pass B: parent_id IS NOT NULL (RIGHT-side identificative pairs).
                for (const sa of sourceAnswers) {
                    if (sa.parent_id == null) continue;
                    const remappedParent = answerIdMap.get(Number(sa.parent_id));
                    if (remappedParent === undefined) {
                        // Orphan parent: source.parent_id pointed to a row not present in
                        // Pass A of THIS question. Could mean cross-question pointer
                        // (source data corruption — T-06-21 acceptance) OR a non-LEFT
                        // ordering anomaly. Fall through with parent_id=null and count.
                        orphan_remaps++;
                    }
                    const newA: any = await tx.quizQuestionAnswer.create({
                        data: {
                            question_id: newQ.id,
                            parent_id: remappedParent ?? null,
                            image: sa.image ?? null,
                            correct: !!sa.correct,
                            created_at: now,
                        },
                        select: { id: true },
                    });
                    answerIdMap.set(Number(sa.id), Number(newA.id));
                    answers_copied++;

                    for (const at of (sa.translations ?? []) as any[]) {
                        await tx.quizQuestionAnswerTranslation.create({
                            data: {
                                quizzes_questions_answer_id: newA.id,
                                locale: at.locale,
                                title: at.title,
                            },
                        });
                    }
                }
            }

            return Number(newQuiz.id);
        });

        await this.cache.invalidate(QUIZZES_INVALIDATE_PATTERN);

        const detail = await readQuizDetail(this.prisma, newQuizId);
        // Surface duplicate stats on the payload so the audit interceptor can read
        // entity_id from `data.id` and downstream observers see the meta.
        const data = {
            ...detail,
            source_quiz_id: sourceId,
            new_quiz_id: newQuizId,
            questions_copied,
            answers_copied,
            orphan_remaps,
        };
        if (orphan_remaps > 0) {
            this.logger.warn(
                `quizzes.duplicate: source ${sourceId} -> new ${newQuizId} had ${orphan_remaps} orphan parent_id remap(s); fell through to null`,
            );
        }
        return apiResponse(1, 'duplicated', 'quizzes.duplicated', data);
    }
}
