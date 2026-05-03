import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { apiResponse } from '../../common/utils/api-response';
import type { ScopeActor } from '../../common/scoping/scope.types';
import type { QuizDetailDto } from './dto/quiz-detail.dto';
import { readQuizDetail } from './quizzes-mutations.service';
import { QuizzesCacheService } from './utils/quizzes-cache.service';

/**
 * QZ-01 + QZ-08 — quiz detail (Plan 04).
 *
 * 403-not-404 hard rule (carry-over from Phase 5 Plan 03 CoursesDetail, mandated by
 * CONTEXT D-21 + Plan 01 QUIZ_SCOPE_RULES):
 *
 *   "curator cannot read a quiz via direct URL access; admin-api returns 403, not 404
 *    or 200. Admin and teacher both pass (D-21 — teacher edits any quiz)."
 *
 * Quiz existence — like course existence in Phase 5 — is operationally non-sensitive
 * for staff. The explicit 403 helps a curator understand they're hitting an entity
 * they don't own (vs a 404 that mistakenly says the quiz was deleted).
 *
 * Implementation pattern (3 steps — identical shape to CoursesDetailService /
 * GroupsDetailService; copy-shape preserves the trust boundary across phases):
 *
 *   1. Existence check WITHOUT scope spread — was the quiz ever real?
 *      Quizzes has no `deleted_at` column (soft-delete = `status='inactive'`); the
 *      existence check ignores status entirely. Inactive quizzes are visible on the
 *      detail page so admins can re-activate via PATCH.
 *   2. Scope check on the loaded row — does this actor have access?
 *        admin            → always allowed (D-21)
 *        teacher          → always allowed (D-21 — VERY PERMISSIVE; the user spec is
 *                            explicit that teachers can edit any quiz/test)
 *        curator          → 403 'quizzes.forbidden_scope' (default-deny per
 *                            QUIZ_SCOPE_RULES.curator; controller @Roles still
 *                            permits curator for surface uniformity, the service
 *                            assertion is what actually enforces the gate).
 *      Failure → ForbiddenException('quizzes.forbidden_scope').
 *   3. Re-read with full select shape (single Prisma findUnique with nested includes
 *      — translations + quiz_category + quiz_badge_items.quiz_badge + questions
 *      + answers + subject — bounded query, no N+1). Race window between step 1
 *      and step 3 → defensive 404 if the row vanished (rare; quiz hard-delete is
 *      not implemented, but a future schema migration could land it).
 *
 * Caching: read-through via QuizzesCacheService.getOrSet, key
 *   geonline-admin:quizzes:detail:<id>:scope:<role>:<actor_id>
 * (scope-suffixed so teacher narrowing — D-21 puts teacher and admin on the same
 * data, but cache key still varies for forensics + future-proofing — and curator
 * never reaches this branch). TTL 60s — same posture as Plan 02 list cache.
 *
 * NOTE: cache READ happens AFTER the existence + scope check so curator access still
 * emits the 403 (cache lookup is bypassed for out-of-scope actors).
 *
 * Projection re-uses the canonical `readQuizDetail` exported from
 * quizzes-mutations.service.ts (Plan 02 SUMMARY decision: projection lives in the
 * mutations service so create/update/duplicate share one shape; Plan 04's detail
 * endpoint imports it to avoid a duplicate definition).
 */
@Injectable()
export class QuizzesDetailService {
    private readonly logger = new Logger(QuizzesDetailService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly cache: QuizzesCacheService,
    ) {}

    public async getDetail(actor: ScopeActor, id: number) {
        // Step 1: Existence check WITHOUT scope spread.
        const exists: any = await this.prisma.quizzes.findUnique({
            where: { id },
            select: { id: true },
        });
        if (!exists) {
            throw new NotFoundException('quizzes.not_found');
        }

        // Step 2: Scope check on the loaded row.
        // admin & teacher always pass (D-21). curator is default-deny.
        if (actor.role_name === 'curator') {
            throw new ForbiddenException('quizzes.forbidden_scope');
        }
        // Defensive: any unexpected role_name not in {admin, curator, teacher} also rejects.
        if (actor.role_name !== 'admin' && actor.role_name !== 'teacher') {
            throw new ForbiddenException('quizzes.forbidden_scope');
        }

        // Step 3: Re-read with full select shape (cached read-through).
        const cacheKey = this.buildCacheKey(actor, id);
        const detail: QuizDetailDto = await this.cache.getOrSet(
            cacheKey,
            () => this.readFullDetail(id),
            60,
        );
        return apiResponse(1, 'ok', 'quizzes.detail', detail);
    }

    /**
     * Race-window-tolerant read. Defensive 404 (T-06-22-style mitigation) if the row
     * vanished between step 1 and step 3 — rare for quizzes (no hard delete in v1).
     */
    private async readFullDetail(id: number): Promise<QuizDetailDto> {
        try {
            return await readQuizDetail(this.prisma, id);
        } catch (err) {
            // readQuizDetail throws NotFoundException('quizzes.not_found') on absent rows.
            if (err instanceof NotFoundException) {
                throw err;
            }
            this.logger.error(
                `readFullDetail unexpected error on quiz ${id}: ${(err as Error).message}`,
            );
            throw err;
        }
    }

    private buildCacheKey(actor: ScopeActor, quizId: number): string {
        return `geonline-admin:quizzes:detail:${quizId}:scope:${actor.role_name}:${actor.id}`;
    }
}
