import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    Logger,
    NotFoundException,
    UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRedis } from '@nestjs-modules/ioredis';
import type { Redis } from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';
import { apiResponse } from '../../common/utils/api-response';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { UpsertQuestionDto, type UpsertQuestionTranslationDto } from './dto/upsert-question.dto';
import { ReorderQuestionsDto } from './dto/reorder-questions.dto';
import {
    computeEditIntentHash,
    signForceConfirmToken,
    verifyForceConfirmToken,
} from './force-confirm.signer';
import { QuizzesCacheService } from './utils/quizzes-cache.service';
import { QUIZZES_INVALIDATE_PATTERN } from './utils/quizzes-cache';
import { sanitizeTiptapHtmlServer } from './utils/sanitize-html-server';
import { nowSec } from './quizzes-mutations.service';

/**
 * QZ-02 / QZ-03 / QZ-06 — admin/teacher question CRUD with destructive-edit
 * detection + force-confirm gate + version-bump-in-tx (Phase 6 Plan 05).
 *
 * THE LYNCHPIN OF PHASE 6.
 *
 * Destructive-edit taxonomy (D-11):
 *
 *   QUESTION:
 *     - title text changed (any locale)        → DESTRUCTIVE
 *     - description Tiptap HTML changed        → DESTRUCTIVE  (compare AFTER server sanitize)
 *     - correct text changed (descriptive)     → DESTRUCTIVE
 *     - type field changed                     → DESTRUCTIVE
 *     - DELETE                                 → DESTRUCTIVE
 *     - grade changed                          → NOT destructive (scoring weight only)
 *     - image / video / answer_video_url       → NOT destructive (presentation)
 *     - reorder                                → NOT destructive (ID-stable grading)
 *     - CREATE a new question                  → NOT destructive (additive)
 *
 * Force-confirm flow (D-12 / D-13 / D-14):
 *   1. Server detects destructive edit intent.
 *   2. Counts open `QuizResult.status='waiting'` rows for this quiz.
 *   3. open > 0 AND no `force_confirm_token` provided →
 *      compute edit_intent_hash, sign 5-min token, throw 409 with envelope.
 *   4. open > 0 AND token provided →
 *      verify signature/expiry, assert sub === actor.id,
 *      assert quiz_id matches path,
 *      recompute edit_intent_hash and compare,
 *      Redis SET NX EX on jti (single-use; T-06-54),
 *      proceed.
 *   5. open == 0 → proceed without 409, but STILL bump version
 *      (destructive edits ALWAYS bump version per D-13; the 409 gate is purely
 *      a UX warning for in-flight attempts).
 *
 * Race-window (T-06-53): version bump is in the SAME prisma.$transaction as the
 * data write. MySQL row-locking on Quizzes serializes concurrent destructive
 * edits — second tx sees post-bump version and increments to N+2.
 *
 * Cross-quiz protection (T-06-50): existing.quiz_id is asserted to match the
 * path :quizId before any write.
 */
@Injectable()
export class QuizzesQuestionsService {
    private readonly logger = new Logger(QuizzesQuestionsService.name);
    private readonly forceSecret: string;

    constructor(
        private readonly prisma: PrismaService,
        private readonly cache: QuizzesCacheService,
        private readonly config: ConfigService,
        @InjectRedis() private readonly redis: Redis,
    ) {
        const s = this.config.get<string>('quizForce.secret') ?? process.env.JWT_QUIZ_FORCE_SECRET;
        if (!s || s.length < 32) {
            throw new Error('JWT_QUIZ_FORCE_SECRET is not configured (or shorter than 32 chars) — refusing to start');
        }
        this.forceSecret = s;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // List
    // ──────────────────────────────────────────────────────────────────────────

    public async listQuestions(actor: ScopeActor, quizId: number) {
        await this.assertQuizScope(actor, quizId);

        const cacheKey = `geonline-admin:quizzes:questions:${quizId}`;
        const data = await this.cache.getOrSet(
            cacheKey,
            async () => {
                const quiz: any = await this.prisma.quizzes.findUnique({
                    where: { id: quizId },
                    select: { version: true },
                });
                const questions: any[] = await this.prisma.quizQuestion.findMany({
                    where: { quiz_id: quizId },
                    include: {
                        translations: true,
                        answers: {
                            include: { translations: true },
                            orderBy: [{ parent_id: 'asc' }, { id: 'asc' }],
                        },
                    },
                    orderBy: [{ order: 'asc' }, { id: 'asc' }],
                });
                return {
                    rows: questions.map((q) => mapQuestionRow(q)),
                    version: Number(quiz?.version ?? 1),
                };
            },
            60,
        );
        return apiResponse(1, 'ok', 'quizzes.questions.list', data);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Create — NOT destructive
    // ──────────────────────────────────────────────────────────────────────────

    public async createQuestion(actor: ScopeActor, quizId: number, dto: UpsertQuestionDto) {
        const quiz = await this.assertQuizScope(actor, quizId);
        if (actor.role_name === 'curator') {
            throw new ForbiddenException(apiResponse(0, 'forbidden_scope', 'quizzes.forbidden_scope'));
        }

        const now = nowSec();

        const created = await this.prisma.$transaction(async (tx) => {
            // Compute next order = max(order) + 1
            const last: any = await tx.quizQuestion.findFirst({
                where: { quiz_id: quizId },
                orderBy: [{ order: 'desc' }, { id: 'desc' }],
                select: { order: true },
            });
            const nextOrder = last && last.order != null ? Number(last.order) + 1 : 1;

            const q: any = await tx.quizQuestion.create({
                data: {
                    quiz_id: quizId,
                    type: dto.type,
                    grade: dto.grade,
                    image: dto.image ?? null,
                    video: dto.video ?? null,
                    answer_video_url: dto.answer_video_url ?? null,
                    order: nextOrder,
                    created_at: now,
                },
                select: { id: true },
            });
            for (const t of dto.translations ?? []) {
                await tx.quizQuestionTranslation.create({
                    data: {
                        quizzes_question_id: q.id,
                        locale: t.locale,
                        title: t.title,
                        description: sanitizeTiptapHtmlServer(t.description ?? null),
                        correct: dto.type === 'descriptive' ? (t.correct ?? null) : null,
                    },
                });
            }
            return q;
        });

        await this.cache.invalidate(QUIZZES_INVALIDATE_PATTERN);

        const refreshed: any = await this.readQuestion(Number(created.id));
        return apiResponse(1, 'created', 'quizzes.question.created', {
            question: refreshed,
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

    public async updateQuestion(
        actor: ScopeActor,
        quizId: number,
        questionId: number,
        dto: UpsertQuestionDto,
    ) {
        const quiz = await this.assertQuizScope(actor, quizId);
        if (actor.role_name === 'curator') {
            throw new ForbiddenException(apiResponse(0, 'forbidden_scope', 'quizzes.forbidden_scope'));
        }

        const existing: any = await this.prisma.quizQuestion.findUnique({
            where: { id: questionId },
            include: { translations: true },
        });
        if (!existing) {
            throw new NotFoundException(apiResponse(0, 'not_found', 'quizzes.question.not_found'));
        }
        if (Number(existing.quiz_id) !== quizId) {
            // T-06-50: cross-quiz tampering
            throw new BadRequestException(apiResponse(0, 'not_in_quiz', 'quizzes.question.not_in_quiz'));
        }

        // ── Destructive-edit detection ─────────────────────────────────────────
        const fieldsChanged: string[] = [];
        if (dto.type !== existing.type) fieldsChanged.push('type');
        for (const t of dto.translations ?? []) {
            const ex = existing.translations.find((x: any) => x.locale === t.locale);
            const sanitizedNewDesc = sanitizeTiptapHtmlServer(t.description ?? null);
            const newCorrect = dto.type === 'descriptive' ? (t.correct ?? null) : null;
            if (!ex) {
                fieldsChanged.push(`translation.${t.locale}.new`);
            } else {
                if ((t.title ?? '') !== (ex.title ?? '')) {
                    fieldsChanged.push(`translation.${t.locale}.title`);
                }
                if (sanitizedNewDesc !== (ex.description ?? '')) {
                    fieldsChanged.push(`translation.${t.locale}.description`);
                }
                if (newCorrect !== (ex.correct ?? null)) {
                    fieldsChanged.push(`translation.${t.locale}.correct`);
                }
            }
        }
        const isDestructive = fieldsChanged.length > 0;

        // ── Force-confirm gate ─────────────────────────────────────────────────
        const { open_attempts_count, force_confirmed } = await this.gateForceConfirm(
            actor,
            quizId,
            isDestructive,
            dto.force_confirm_token ?? null,
            stripVolatile(dto),
        );

        // ── Apply update + (if destructive) version bump in SAME $tx ──────────
        const fromVersion = Number(quiz.version ?? 1);
        const toVersion = await this.prisma.$transaction(async (tx) => {
            await tx.quizQuestion.update({
                where: { id: questionId },
                data: {
                    type: dto.type,
                    grade: dto.grade,
                    image: dto.image ?? null,
                    video: dto.video ?? null,
                    answer_video_url: dto.answer_video_url ?? null,
                    updated_at: nowSec(),
                },
            });
            for (const t of dto.translations ?? []) {
                await this.upsertQuestionTranslation(tx, questionId, t, dto.type);
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

        const refreshed = await this.readQuestion(questionId);
        return apiResponse(1, 'updated', 'quizzes.question.updated', {
            question: refreshed,
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

    public async deleteQuestion(
        actor: ScopeActor,
        quizId: number,
        questionId: number,
        forceConfirmToken: string | null,
    ) {
        const quiz = await this.assertQuizScope(actor, quizId);
        if (actor.role_name === 'curator') {
            throw new ForbiddenException(apiResponse(0, 'forbidden_scope', 'quizzes.forbidden_scope'));
        }

        const existing: any = await this.prisma.quizQuestion.findUnique({
            where: { id: questionId },
            select: { id: true, quiz_id: true },
        });
        if (!existing) {
            throw new NotFoundException(apiResponse(0, 'not_found', 'quizzes.question.not_found'));
        }
        if (Number(existing.quiz_id) !== quizId) {
            throw new BadRequestException(apiResponse(0, 'not_in_quiz', 'quizzes.question.not_in_quiz'));
        }

        // Delete is always destructive. Hash binds to {action: 'delete', question_id}.
        const intentPayload = { action: 'delete', quiz_id: quizId, question_id: questionId };
        const { open_attempts_count, force_confirmed } = await this.gateForceConfirm(
            actor,
            quizId,
            true,
            forceConfirmToken,
            intentPayload,
        );

        const fromVersion = Number(quiz.version ?? 1);
        const toVersion = await this.prisma.$transaction(async (tx) => {
            // schema cascades translations + answers + answer translations
            await tx.quizQuestion.delete({ where: { id: questionId } });
            const bumped: any = await tx.quizzes.update({
                where: { id: quizId },
                data: { version: { increment: 1 }, updated_at: nowSec() },
                select: { version: true },
            });
            return Number(bumped.version);
        });

        await this.cache.invalidate(QUIZZES_INVALIDATE_PATTERN);
        return apiResponse(1, 'deleted', 'quizzes.question.deleted', {
            id: questionId,
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
    // Reorder — NOT destructive
    // ──────────────────────────────────────────────────────────────────────────

    public async reorderQuestions(actor: ScopeActor, quizId: number, dto: ReorderQuestionsDto) {
        await this.assertQuizScope(actor, quizId);
        if (actor.role_name === 'curator') {
            throw new ForbiddenException(apiResponse(0, 'forbidden_scope', 'quizzes.forbidden_scope'));
        }

        const ids = dto.items.map((i) => i.id);
        // T-06-51 pre-flight: verify all ids belong to this quiz
        const owned: any[] = await this.prisma.quizQuestion.findMany({
            where: { id: { in: ids }, quiz_id: quizId },
            select: { id: true },
        });
        if (owned.length !== ids.length) {
            throw new BadRequestException(apiResponse(0, 'reorder.foreign_id', 'quizzes.reorder.foreign_id'));
        }

        await this.prisma.$transaction(async (tx) => {
            for (const it of dto.items) {
                await tx.quizQuestion.update({
                    where: { id: it.id },
                    data: { order: it.order, updated_at: nowSec() },
                });
            }
        });
        await this.cache.invalidate(QUIZZES_INVALIDATE_PATTERN);

        return apiResponse(1, 'reordered', 'quizzes.questions.reordered', {
            items: dto.items,
            destructive: false,
            force_confirmed: false,
            open_attempts_at_force: 0,
        });
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Internals
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * Used by Plan 05 questions controller AND by QuizzesAnswersService (the
     * answers service needs the parent quiz row + version for its own
     * destructive-gate flow). Exposed `public` for the cross-service call.
     */
    public async assertQuizScope(actor: ScopeActor, quizId: number): Promise<{ id: number; version: number }> {
        const quiz: any = await this.prisma.quizzes.findUnique({
            where: { id: quizId },
            select: { id: true, version: true },
        });
        if (!quiz) {
            throw new NotFoundException(apiResponse(0, 'not_found', 'quizzes.not_found'));
        }
        if (actor.role_name !== 'admin' && actor.role_name !== 'teacher' && actor.role_name !== 'curator') {
            throw new ForbiddenException(apiResponse(0, 'forbidden_scope', 'quizzes.forbidden_scope'));
        }
        return { id: Number(quiz.id), version: Number(quiz.version ?? 1) };
    }

    /**
     * Force-confirm gate. Centralizes the 409 / verify / Redis SET NX flow.
     * Called by every destructive mutation in this service AND by the answers
     * service. Returns the validated state for audit-meta extraction.
     *
     * - isDestructive=false → bypass (returns zeros)
     * - destructive AND open_attempts==0 → bypass (returns the count, force_confirmed=false)
     * - destructive AND open_attempts>0 AND no token → 409 with new token
     * - destructive AND open_attempts>0 AND token → verify + Redis SET NX → returns force_confirmed=true
     */
    public async gateForceConfirm(
        actor: ScopeActor,
        quizId: number,
        isDestructive: boolean,
        token: string | null,
        intentPayload: unknown,
    ): Promise<{ open_attempts_count: number; force_confirmed: boolean }> {
        if (!isDestructive) {
            return { open_attempts_count: 0, force_confirmed: false };
        }

        const open_attempts_count = await this.prisma.quizResult.count({
            where: { quiz_id: quizId, status: 'waiting' },
        });
        if (open_attempts_count <= 0) {
            // Destructive but no open attempts — proceed; version bump still happens upstream.
            return { open_attempts_count: 0, force_confirmed: false };
        }

        if (!token) {
            const intentHash = computeEditIntentHash(intentPayload);
            const signed = signForceConfirmToken(
                { actor_id: actor.id, quiz_id: quizId, edit_intent_hash: intentHash },
                this.forceSecret,
                300,
            );
            // 409 with envelope (matches D-12 + force-confirm.dto.ts ForceConfirmEnvelope shape)
            throw new ConflictException({
                status: 'quizzes.force_confirm_required',
                message: 'quizzes.force_confirm_required',
                open_attempts_count,
                force_confirm_token: signed.token,
                expires_at: signed.expires_at,
            });
        }

        // Token provided — verify
        let claims;
        try {
            claims = verifyForceConfirmToken(token, this.forceSecret);
        } catch (err) {
            this.logger.warn(`force-confirm verify failed: ${(err as Error).message}`);
            throw new UnauthorizedException(
                apiResponse(0, 'force_confirm.invalid', 'quizzes.force_confirm.invalid'),
            );
        }
        if (claims.sub !== actor.id) {
            throw new UnauthorizedException(
                apiResponse(0, 'force_confirm.actor_mismatch', 'quizzes.force_confirm.invalid'),
            );
        }
        if (claims.quiz_id !== quizId) {
            throw new UnauthorizedException(
                apiResponse(0, 'force_confirm.quiz_mismatch', 'quizzes.force_confirm.invalid'),
            );
        }
        const expectedHash = computeEditIntentHash(intentPayload);
        if (claims.edit_intent_hash !== expectedHash) {
            throw new UnauthorizedException(
                apiResponse(0, 'force_confirm.payload_changed', 'quizzes.force_confirm.payload_changed'),
            );
        }

        // T-06-54 replay protection: SET NX on jti for the remaining TTL.
        const ttlRemaining = Math.max(1, claims.exp - Math.floor(Date.now() / 1000));
        const jtiKey = `geonline-admin:quizzes:force-confirm:jti:${claims.jti}`;
        const setResult = await this.redis.set(jtiKey, '1', 'EX', ttlRemaining, 'NX');
        if (setResult !== 'OK') {
            throw new ConflictException(
                apiResponse(0, 'force_confirm.token_already_used', 'quizzes.force_confirm.token_already_used'),
            );
        }

        return { open_attempts_count, force_confirmed: true };
    }

    /**
     * Per-locale upsert. QuizQuestionTranslation has no @@unique constraint;
     * we use find-then-update inside the caller's transaction (FIRST row per
     * locale wins, mirroring QuizzesMutationsService.update pattern).
     */
    private async upsertQuestionTranslation(
        tx: any,
        questionId: number,
        t: UpsertQuestionTranslationDto,
        questionType: string,
    ): Promise<void> {
        const sanitized = sanitizeTiptapHtmlServer(t.description ?? null);
        const correctValue = questionType === 'descriptive' ? (t.correct ?? null) : null;
        const ex: any = await tx.quizQuestionTranslation.findFirst({
            where: { quizzes_question_id: questionId, locale: t.locale },
            select: { id: true },
            orderBy: { id: 'asc' },
        });
        if (ex) {
            await tx.quizQuestionTranslation.update({
                where: { id: ex.id },
                data: { title: t.title, description: sanitized, correct: correctValue },
            });
        } else {
            await tx.quizQuestionTranslation.create({
                data: {
                    quizzes_question_id: questionId,
                    locale: t.locale,
                    title: t.title,
                    description: sanitized,
                    correct: correctValue,
                },
            });
        }
    }

    private async readQuestion(questionId: number) {
        const q: any = await this.prisma.quizQuestion.findUnique({
            where: { id: questionId },
            include: {
                translations: true,
                answers: {
                    include: { translations: true },
                    orderBy: [{ parent_id: 'asc' }, { id: 'asc' }],
                },
            },
        });
        if (!q) throw new NotFoundException(apiResponse(0, 'not_found', 'quizzes.question.not_found'));
        return mapQuestionRow(q);
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Strip `force_confirm_token` (and any client-only fields) from a DTO before
 * computing edit_intent_hash. The token itself MUST NOT be in the hashed
 * payload (T-06-55: identical-but-different-token attempts must produce the
 * same hash so the verifier can bind a single token to a single edit).
 */
export function stripVolatile(dto: UpsertQuestionDto): Record<string, unknown> {
    const { force_confirm_token: _drop, ...rest } = dto;
    return rest as unknown as Record<string, unknown>;
}

export function mapQuestionRow(q: any): any {
    return {
        id: Number(q.id),
        type: q.type,
        grade: Number(q.grade ?? 0),
        image: q.image ?? null,
        video: q.video ?? null,
        answer_video_url: q.answer_video_url ?? null,
        order: q.order == null ? null : Number(q.order),
        translations: ((q.translations ?? []) as any[])
            .filter((t) => t.locale === 'kz')
            .map((t) => ({
                locale: t.locale,
                title: t.title,
                description: t.description ?? null,
                correct: t.correct ?? null,
            })),
        answers: ((q.answers ?? []) as any[]).map((a) => ({
            id: Number(a.id),
            parent_id: a.parent_id == null ? null : Number(a.parent_id),
            image: a.image ?? null,
            correct: !!a.correct,
            translations: ((a.translations ?? []) as any[])
                .filter((t) => t.locale === 'kz')
                .map((t) => ({ locale: t.locale, title: t.title })),
            created_at: Number(a.created_at),
            updated_at: a.updated_at == null ? null : Number(a.updated_at),
        })),
        created_at: Number(q.created_at),
        updated_at: q.updated_at == null ? null : Number(q.updated_at),
    };
}
