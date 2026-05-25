import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { apiResponse } from '../../common/utils/api-response';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { UpsertAnswerDto, type UpsertAnswerTranslationDto } from './dto/upsert-answer.dto';
import { QuizzesCacheService } from './utils/quizzes-cache.service';
import { QUIZZES_INVALIDATE_PATTERN } from './utils/quizzes-cache';
import { QuizzesQuestionsService } from './quizzes-questions.service';
import { nowSec } from './quizzes-mutations.service';

/**
 * QZ-02 / QZ-03 / QZ-06 — admin/teacher answer CRUD with destructive-edit
 * detection + force-confirm gate (Phase 6 Plan 05).
 *
 * Mirrors QuizzesQuestionsService for the answer surface. Reuses
 * QuizzesQuestionsService.gateForceConfirm (centralized force-confirm logic
 * + Redis SET NX + computeEditIntentHash) — keeps the verification rules in
 * ONE place.
 *
 * Destructive-edit taxonomy (D-11) for answers:
 *
 *   - title text changed (any locale)        → DESTRUCTIVE
 *   - correct flag changed                   → DESTRUCTIVE
 *   - parent_id changed                      → DESTRUCTIVE (reshapes pair)
 *   - DELETE                                 → DESTRUCTIVE
 *   - image swap                             → NOT destructive (presentation)
 *   - CREATE a new answer                    → NOT destructive (additive — even
 *                                              for identificative pair RIGHT-side
 *                                              row addition; D-11 explicitly does
 *                                              NOT list "add answer" as destructive)
 *
 * Cross-question protection (T-06-52): if dto.parent_id is provided, verify the
 * parent answer belongs to the SAME question_id. Same trust-boundary mitigation
 * as T-06-50 for questions.
 */
@Injectable()
export class QuizzesAnswersService {
    private readonly logger = new Logger(QuizzesAnswersService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly cache: QuizzesCacheService,
        private readonly questionsService: QuizzesQuestionsService,
    ) {}

    // ──────────────────────────────────────────────────────────────────────────
    // Create — NOT destructive
    // ──────────────────────────────────────────────────────────────────────────

    public async createAnswer(
        actor: ScopeActor,
        quizId: number,
        questionId: number,
        dto: UpsertAnswerDto,
    ) {
        const quiz = await this.questionsService.assertQuizScope(actor, quizId);
        if (actor.role_name === 'curator') {
            throw new ForbiddenException(apiResponse(0, 'forbidden_scope', 'quizzes.forbidden_scope'));
        }

        // Question existence + cross-quiz check
        const question: any = await this.prisma.quizQuestion.findUnique({
            where: { id: questionId },
            select: { id: true, quiz_id: true },
        });
        if (!question) {
            throw new NotFoundException(apiResponse(0, 'not_found', 'quizzes.question.not_found'));
        }
        if (Number(question.quiz_id) !== quizId) {
            throw new BadRequestException(apiResponse(0, 'not_in_quiz', 'quizzes.question.not_in_quiz'));
        }

        // T-06-52: cross-question parent_id check
        if (dto.parent_id != null) {
            const parent: any = await this.prisma.quizQuestionAnswer.findUnique({
                where: { id: dto.parent_id },
                select: { id: true, question_id: true },
            });
            if (!parent || Number(parent.question_id) !== questionId) {
                throw new BadRequestException(
                    apiResponse(0, 'parent_in_other_question', 'quizzes.answers.parent_in_other_question'),
                );
            }
        }

        // Phase 24: match_target_id cross-question + chain checks. The target must
        // exist in the SAME question and itself be an option (match_target_id = null) —
        // we don't allow prompts to point to prompts.
        if (dto.match_target_id != null) {
            const target: any = await this.prisma.quizQuestionAnswer.findUnique({
                where: { id: dto.match_target_id },
                select: { id: true, question_id: true, match_target_id: true },
            });
            if (!target || Number(target.question_id) !== questionId) {
                throw new BadRequestException(
                    apiResponse(0, 'match_target_in_other_question', 'quizzes.answers.match_target_in_other_question'),
                );
            }
            if (target.match_target_id != null) {
                throw new BadRequestException(
                    apiResponse(0, 'match_target_is_prompt', 'quizzes.answers.match_target_is_prompt'),
                );
            }
        }

        const now = nowSec();
        const created = await this.prisma.$transaction(async (tx) => {
            const a: any = await tx.quizQuestionAnswer.create({
                data: {
                    question_id: questionId,
                    parent_id: dto.parent_id ?? null,
                    match_target_id: dto.match_target_id ?? null,
                    correct: !!dto.correct,
                    image: dto.image ?? null,
                    created_at: now,
                },
                select: { id: true },
            });
            for (const t of dto.translations ?? []) {
                await tx.quizQuestionAnswerTranslation.create({
                    data: {
                        quizzes_questions_answer_id: a.id,
                        locale: t.locale,
                        title: t.title,
                    },
                });
            }
            return a;
        });

        await this.cache.invalidate(QUIZZES_INVALIDATE_PATTERN);
        const refreshed = await this.readAnswer(Number(created.id));
        return apiResponse(1, 'created', 'quizzes.answer.created', {
            answer: refreshed,
            version: Number(quiz.version ?? 1),
            destructive: false,
            from_version: Number(quiz.version ?? 1),
            to_version: Number(quiz.version ?? 1),
            force_confirmed: false,
            open_attempts_at_force: 0,
            fields_changed: [] as string[],
        });
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Update — DESTRUCTIVE-EDIT DETECTION + FORCE-CONFIRM GATE + VERSION BUMP
    // ──────────────────────────────────────────────────────────────────────────

    public async updateAnswer(
        actor: ScopeActor,
        quizId: number,
        questionId: number,
        answerId: number,
        dto: UpsertAnswerDto,
    ) {
        const quiz = await this.questionsService.assertQuizScope(actor, quizId);
        if (actor.role_name === 'curator') {
            throw new ForbiddenException(apiResponse(0, 'forbidden_scope', 'quizzes.forbidden_scope'));
        }

        const existing: any = await this.prisma.quizQuestionAnswer.findUnique({
            where: { id: answerId },
            include: { translations: true, question: { select: { id: true, quiz_id: true } } },
        });
        if (!existing) {
            throw new NotFoundException(apiResponse(0, 'not_found', 'quizzes.answer.not_found'));
        }
        if (Number(existing.question_id) !== questionId) {
            throw new BadRequestException(
                apiResponse(0, 'not_in_question', 'quizzes.answers.not_in_question'),
            );
        }
        if (Number(existing.question?.quiz_id) !== quizId) {
            throw new BadRequestException(apiResponse(0, 'not_in_quiz', 'quizzes.question.not_in_quiz'));
        }

        // T-06-52: parent_id cross-question check on update too
        if (dto.parent_id != null) {
            const parent: any = await this.prisma.quizQuestionAnswer.findUnique({
                where: { id: dto.parent_id },
                select: { id: true, question_id: true },
            });
            if (!parent || Number(parent.question_id) !== questionId) {
                throw new BadRequestException(
                    apiResponse(0, 'parent_in_other_question', 'quizzes.answers.parent_in_other_question'),
                );
            }
        }

        // Phase 24: same cross-question + chain checks for match_target_id.
        if (dto.match_target_id != null) {
            // Anti-self-reference: prompt cannot point to itself.
            if (dto.match_target_id === answerId) {
                throw new BadRequestException(
                    apiResponse(0, 'match_target_self', 'quizzes.answers.match_target_self'),
                );
            }
            const target: any = await this.prisma.quizQuestionAnswer.findUnique({
                where: { id: dto.match_target_id },
                select: { id: true, question_id: true, match_target_id: true },
            });
            if (!target || Number(target.question_id) !== questionId) {
                throw new BadRequestException(
                    apiResponse(0, 'match_target_in_other_question', 'quizzes.answers.match_target_in_other_question'),
                );
            }
            if (target.match_target_id != null) {
                throw new BadRequestException(
                    apiResponse(0, 'match_target_is_prompt', 'quizzes.answers.match_target_is_prompt'),
                );
            }
        }

        // ── Destructive-edit detection ─────────────────────────────────────────
        const fieldsChanged: string[] = [];
        if (!!dto.correct !== !!existing.correct) fieldsChanged.push('correct');
        const newParentId = dto.parent_id ?? null;
        const oldParentId = existing.parent_id == null ? null : Number(existing.parent_id);
        if (newParentId !== oldParentId) fieldsChanged.push('parent_id');
        const newMatchId = dto.match_target_id ?? null;
        const oldMatchId = existing.match_target_id == null ? null : Number(existing.match_target_id);
        if (newMatchId !== oldMatchId) fieldsChanged.push('match_target_id');
        for (const t of dto.translations ?? []) {
            const ex = existing.translations.find((x: any) => x.locale === t.locale);
            if (!ex) {
                fieldsChanged.push(`translation.${t.locale}.new`);
            } else if ((t.title ?? '') !== (ex.title ?? '')) {
                fieldsChanged.push(`translation.${t.locale}.title`);
            }
        }
        const isDestructive = fieldsChanged.length > 0;

        // ── Force-confirm gate ─────────────────────────────────────────────────
        const intentPayload = stripVolatileAnswer(dto);
        const { open_attempts_count, force_confirmed } = await this.questionsService.gateForceConfirm(
            actor,
            quizId,
            isDestructive,
            dto.force_confirm_token ?? null,
            intentPayload,
        );

        // ── Apply update + (if destructive) version bump in SAME $tx ──────────
        const fromVersion = Number(quiz.version ?? 1);
        const toVersion = await this.prisma.$transaction(async (tx) => {
            await tx.quizQuestionAnswer.update({
                where: { id: answerId },
                data: {
                    correct: !!dto.correct,
                    parent_id: dto.parent_id ?? null,
                    match_target_id: dto.match_target_id ?? null,
                    image: dto.image ?? null,
                    updated_at: nowSec(),
                },
            });
            for (const t of dto.translations ?? []) {
                await this.upsertAnswerTranslation(tx, answerId, t);
            }
            if (isDestructive) {
                const bumped: any = await tx.quizzes.update({
                    where: { id: quizId },
                    data: { version: { increment: 1 }, updated_at: nowSec() },
                    select: { version: true },
                });
                return Number(bumped.version);
            }
            return fromVersion;
        });

        await this.cache.invalidate(QUIZZES_INVALIDATE_PATTERN);
        const refreshed = await this.readAnswer(answerId);
        return apiResponse(1, 'updated', 'quizzes.answer.updated', {
            answer: refreshed,
            version: toVersion,
            destructive: isDestructive,
            from_version: fromVersion,
            to_version: toVersion,
            force_confirmed,
            open_attempts_at_force: open_attempts_count,
            fields_changed: fieldsChanged,
        });
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Delete — ALWAYS DESTRUCTIVE
    // ──────────────────────────────────────────────────────────────────────────

    public async deleteAnswer(
        actor: ScopeActor,
        quizId: number,
        questionId: number,
        answerId: number,
        forceConfirmToken: string | null,
    ) {
        const quiz = await this.questionsService.assertQuizScope(actor, quizId);
        if (actor.role_name === 'curator') {
            throw new ForbiddenException(apiResponse(0, 'forbidden_scope', 'quizzes.forbidden_scope'));
        }

        const existing: any = await this.prisma.quizQuestionAnswer.findUnique({
            where: { id: answerId },
            select: {
                id: true,
                question_id: true,
                question: { select: { quiz_id: true } },
            },
        });
        if (!existing) {
            throw new NotFoundException(apiResponse(0, 'not_found', 'quizzes.answer.not_found'));
        }
        if (Number(existing.question_id) !== questionId) {
            throw new BadRequestException(
                apiResponse(0, 'not_in_question', 'quizzes.answers.not_in_question'),
            );
        }
        if (Number((existing.question as any)?.quiz_id) !== quizId) {
            throw new BadRequestException(apiResponse(0, 'not_in_quiz', 'quizzes.question.not_in_quiz'));
        }

        const intentPayload = {
            action: 'delete',
            quiz_id: quizId,
            question_id: questionId,
            answer_id: answerId,
        };
        const { open_attempts_count, force_confirmed } = await this.questionsService.gateForceConfirm(
            actor,
            quizId,
            true,
            forceConfirmToken,
            intentPayload,
        );

        const fromVersion = Number(quiz.version ?? 1);
        const toVersion = await this.prisma.$transaction(async (tx) => {
            // Schema cascades: deleting a LEFT (parent_id=null) row drops its RIGHT
            // children via QuizQuestionAnswer parent FK onDelete: Cascade.
            // Translations cascade via the answer FK.
            await tx.quizQuestionAnswer.delete({ where: { id: answerId } });
            const bumped: any = await tx.quizzes.update({
                where: { id: quizId },
                data: { version: { increment: 1 }, updated_at: nowSec() },
                select: { version: true },
            });
            return Number(bumped.version);
        });

        await this.cache.invalidate(QUIZZES_INVALIDATE_PATTERN);
        return apiResponse(1, 'deleted', 'quizzes.answer.deleted', {
            id: answerId,
            version: toVersion,
            destructive: true,
            from_version: fromVersion,
            to_version: toVersion,
            force_confirmed,
            open_attempts_at_force: open_attempts_count,
            fields_changed: ['delete'],
        });
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Internals
    // ──────────────────────────────────────────────────────────────────────────

    private async upsertAnswerTranslation(
        tx: any,
        answerId: number,
        t: UpsertAnswerTranslationDto,
    ): Promise<void> {
        const ex: any = await tx.quizQuestionAnswerTranslation.findFirst({
            where: { quizzes_questions_answer_id: answerId, locale: t.locale },
            select: { id: true },
            orderBy: { id: 'asc' },
        });
        if (ex) {
            await tx.quizQuestionAnswerTranslation.update({
                where: { id: ex.id },
                data: { title: t.title },
            });
        } else {
            await tx.quizQuestionAnswerTranslation.create({
                data: {
                    quizzes_questions_answer_id: answerId,
                    locale: t.locale,
                    title: t.title,
                },
            });
        }
    }

    private async readAnswer(answerId: number) {
        const a: any = await this.prisma.quizQuestionAnswer.findUnique({
            where: { id: answerId },
            include: { translations: true },
        });
        if (!a) throw new NotFoundException(apiResponse(0, 'not_found', 'quizzes.answer.not_found'));
        return {
            id: Number(a.id),
            parent_id: a.parent_id == null ? null : Number(a.parent_id),
            match_target_id: a.match_target_id == null ? null : Number(a.match_target_id),
            image: a.image ?? null,
            correct: !!a.correct,
            translations: ((a.translations ?? []) as any[])
                .filter((t) => t.locale === 'kz')
                .map((t) => ({ locale: t.locale, title: t.title })),
            created_at: Number(a.created_at),
            updated_at: a.updated_at == null ? null : Number(a.updated_at),
        };
    }
}

export function stripVolatileAnswer(dto: UpsertAnswerDto): Record<string, unknown> {
    const { force_confirm_token: _drop, ...rest } = dto;
    return rest as unknown as Record<string, unknown>;
}
