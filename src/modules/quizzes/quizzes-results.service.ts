import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { buildScopeWhere } from '../../common/scoping/scope.helper';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { ListResultsDto } from './dto/list-results.dto';
import { QUIZ_RESULT_SCOPE_RULES } from './quizzes.scope';
import { QuizzesCacheService } from './utils/quizzes-cache.service';
import { createHash } from 'node:crypto';

/**
 * QZ-08 + QZ-09 — paginated, RBAC-scoped quiz-result list service (Plan 07).
 *
 * RBAC scope (CONTEXT D-22 + D-23):
 *
 *   admin   -> sees ALL results across every quiz/user/webinar.
 *   curator -> narrowed by `user.group_users[*].group.supervisor_id === actor.id`.
 *              Plain spread of `buildScopeWhere(actor, QUIZ_RESULT_SCOPE_RULES)`
 *              works because the curator producer in scope.ts is sync + correct.
 *   teacher -> narrowed by `webinar_id IN (teacher's own webinars)`.
 *              ★ MANUAL TWO-STEP ★ — the `teacher` rule in QUIZ_RESULT_SCOPE_RULES
 *              is a documented placeholder that returns `{ webinar_id: { in: [] } }`
 *              (default-deny). We CANNOT inline the lookup in the rule producer
 *              because ScopeRules producers are sync and receive only
 *              `{ id, role_name }` (no PrismaService). Plan 01 deferred the real
 *              lookup to this service. Workflow:
 *                1. await prisma.webinar.findMany({ where: { teacher_id: actor.id }, select: { id: true } })
 *                2. If teacherWebinars is empty → short-circuit with empty result
 *                   (default-deny — no leak to other teachers' content).
 *                3. Otherwise narrow `where.webinar_id = { in: teacherWebinars.map(w => w.id) }`
 *              See `quizzes.scope.ts` header comment for the original placeholder
 *              rationale and T-06-02 + T-06-81 in this plan's threat model.
 *
 * `is_stale_version` flag (QZ-06 surface):
 *   For each row, computed as
 *     `row.quiz_version_at_start != null && row.quiz_version_at_start !== row.quiz.version`.
 *   When true, the UI surfaces an orange "Устаревшая версия" Badge — admins
 *   can see WHICH in-flight attempts started before a force-confirmed
 *   destructive edit (their student's grade will be computed against the
 *   pre-bump question set). T-06-88 in threat model: this is intended UX.
 *
 * `badge_id` filter resolution:
 *   When supplied, we look up `QuizBadgeItem.findMany({ quiz_badge_id })` and
 *   narrow `where.quiz_id = { in: items.quiz_id[] }`. If both `quiz_id` and
 *   `badge_id` are supplied, the explicit `quiz_id` MUST be in the badge's set
 *   — otherwise we short-circuit with empty result (T-06-83).
 *
 * Cache:
 *   Read-only listing wrapped in QuizzesCacheService.getOrSet at TTL=30s.
 *   Cache key embeds role + actor_id BEFORE the filter hash (T-06-07 mitigation
 *   from Plan 01: admin's cache slot can never be served to a teacher).
 *
 *   IMPORTANT: result rows are written by the student-facing glucose-api (NOT
 *   by admin-api). Admin-api therefore CANNOT proactively invalidate this cache
 *   on row writes. 30s staleness is acceptable for admin oversight (T-06-89).
 *
 * Response shape: see ListResultsResponse below. Mirrors admin-client
 * `lib/quizzes/types.ts` QuizResultsListResponse + QuizResultRow types
 * (Plan 01 contract — extended in Plan 07 with version + is_stale_version).
 */

export interface QuizResultUserRefDto {
    id: number;
    full_name: string | null;
    email: string | null;
}

export interface QuizResultQuizRefDto {
    id: number;
    title_ru: string | null;
    kz_title?: string | null;
    /** Current quiz version (used for `is_stale_version` comparison). */
    version: number;
}

export interface QuizResultRowDto {
    id: number;
    quiz: QuizResultQuizRefDto | null;
    user: QuizResultUserRefDto | null;
    /** Webinar context at attempt time; null = standalone attempt. */
    webinar_id: number | null;
    /** Phase 1.08 snapshot — version of the quiz at attempt start. */
    quiz_version_at_start: number | null;
    user_grade: number | null;
    status: 'waiting' | 'passed' | 'failed';
    /** Computed: row.quiz_version_at_start != null && != row.quiz.version. */
    is_stale_version: boolean;
    /** Unix seconds. */
    created_at: number;
}

export interface ListResultsResponse {
    rows: QuizResultRowDto[];
    total: number;
    page: number;
    page_size: number;
}

@Injectable()
export class QuizzesResultsService {
    private readonly logger = new Logger(QuizzesResultsService.name);

    public static readonly DEFAULT_PAGE_SIZE = 50;
    public static readonly MAX_PAGE_SIZE = 200;
    public static readonly LIST_CACHE_TTL_SECONDS = 30;

    constructor(
        private readonly prisma: PrismaService,
        private readonly cache: QuizzesCacheService,
    ) {}

    public async listResults(actor: ScopeActor, filters: ListResultsDto): Promise<ListResultsResponse> {
        const cacheKey = this.buildCacheKey(actor, filters);
        return this.cache.getOrSet<ListResultsResponse>(
            cacheKey,
            () => this.runQuery(actor, filters),
            QuizzesResultsService.LIST_CACHE_TTL_SECONDS,
        );
    }

    private buildCacheKey(actor: ScopeActor, filters: ListResultsDto): string {
        const sortedKeys = Object.keys(filters as Record<string, unknown>).sort();
        const normalized = JSON.stringify(filters, sortedKeys);
        const hash = createHash('sha1').update(normalized).digest('hex').slice(0, 16);
        return `geonline-admin:quizzes:results:list:${actor.role_name}:${actor.id}:${hash}`;
    }

    private async runQuery(actor: ScopeActor, filters: ListResultsDto): Promise<ListResultsResponse> {
        const page = Math.max(1, filters.page ?? 1);
        const page_size = Math.min(
            QuizzesResultsService.MAX_PAGE_SIZE,
            Math.max(1, filters.page_size ?? QuizzesResultsService.DEFAULT_PAGE_SIZE),
        );
        const order: 'asc' | 'desc' = filters.order ?? 'desc';
        const skip = (page - 1) * page_size;

        // ---- Build base WHERE from explicit filters ----
        const where: any = {};

        if (typeof filters.quiz_id === 'number') where.quiz_id = filters.quiz_id;
        if (typeof filters.user_id === 'number') where.user_id = filters.user_id;
        if (filters.status) where.status = filters.status;

        if (typeof filters.date_from === 'number' || typeof filters.date_to === 'number') {
            where.created_at = {};
            if (typeof filters.date_from === 'number') where.created_at.gte = filters.date_from;
            if (typeof filters.date_to === 'number') where.created_at.lte = filters.date_to;
        }

        const needle = filters.q?.trim();
        if (needle && needle.length > 0) {
            where.user = {
                OR: [{ full_name: { contains: needle } }, { email: { contains: needle } }],
            };
        }

        // ---- Resolve badge_id to quiz_ids if filter present (T-06-83) ----
        if (typeof filters.badge_id === 'number') {
            const items = await this.prisma.quizBadgeItem.findMany({
                where: { quiz_badge_id: filters.badge_id },
                select: { quiz_id: true },
            });
            const quizIds = items.map((i) => i.quiz_id);

            if (typeof filters.quiz_id === 'number') {
                if (!quizIds.includes(filters.quiz_id)) {
                    // explicit quiz not in badge → empty
                    return { rows: [], total: 0, page, page_size };
                }
                // explicit quiz_id already set on `where`; fall through.
            } else {
                where.quiz_id = quizIds.length > 0 ? { in: quizIds } : { in: [-1] };
            }
        }

        // ---- Apply role scope ----
        if (actor.role_name === 'curator') {
            // buildScopeWhere works for curator (Plan 01 producer is correct).
            const scopeWhere = buildScopeWhere(actor, QUIZ_RESULT_SCOPE_RULES) as Record<string, unknown>;
            // Merge: curator's `user` predicate AND'd with any q-search `user` predicate.
            if (where.user && (scopeWhere as any).user) {
                where.user = { AND: [where.user, (scopeWhere as any).user] };
                delete (scopeWhere as any).user;
            }
            Object.assign(where, scopeWhere);
        } else if (actor.role_name === 'teacher') {
            // ★ MANUAL TWO-STEP — see service header for rationale ★
            const teacherWebinars = await this.prisma.webinar.findMany({
                where: { teacher_id: actor.id },
                select: { id: true },
            });
            if (teacherWebinars.length === 0) {
                // default-deny: teacher with zero webinars sees nothing.
                return { rows: [], total: 0, page, page_size };
            }
            where.webinar_id = { in: teacherWebinars.map((w) => w.id) };
        }
        // admin: no scope narrowing (rule omitted in QUIZ_RESULT_SCOPE_RULES).

        // ---- Total + rows in parallel ----
        const [total, rowsRaw] = await Promise.all([
            this.prisma.quizResult.count({ where }),
            this.prisma.quizResult.findMany({
                where,
                orderBy: [{ created_at: order }, { id: order }],
                skip,
                take: page_size,
                select: {
                    id: true,
                    quiz_id: true,
                    user_id: true,
                    webinar_id: true,
                    quiz_version_at_start: true,
                    user_grade: true,
                    status: true,
                    created_at: true,
                    quiz: {
                        select: {
                            id: true,
                            version: true,
                            translations: { select: { locale: true, title: true } },
                        },
                    },
                    user: {
                        select: { id: true, full_name: true, email: true },
                    },
                },
            }),
        ]);

        const rows: QuizResultRowDto[] = (rowsRaw as any[]).map((r) => this.mapRow(r));

        return { rows, total, page, page_size };
    }

    private mapRow(r: any): QuizResultRowDto {
        const translations: Array<{ locale: string; title: string | null }> = r.quiz?.translations ?? [];
        const ruTitle = translations.find((t) => t.locale === 'ru')?.title ?? null;
        const kzTitle = translations.find((t) => t.locale === 'kz')?.title ?? null;
        const quizVersion: number = Number(r.quiz?.version ?? 1);
        const versionAtStart: number | null = r.quiz_version_at_start == null ? null : Number(r.quiz_version_at_start);
        const is_stale_version = versionAtStart != null && versionAtStart !== quizVersion;

        return {
            id: Number(r.id),
            quiz: r.quiz
                ? {
                      id: Number(r.quiz.id),
                      title_ru: ruTitle,
                      kz_title: kzTitle,
                      version: quizVersion,
                  }
                : null,
            user: r.user
                ? {
                      id: Number(r.user.id),
                      full_name: r.user.full_name ?? null,
                      email: r.user.email ?? null,
                  }
                : null,
            webinar_id: r.webinar_id == null ? null : Number(r.webinar_id),
            quiz_version_at_start: versionAtStart,
            user_grade: r.user_grade == null ? null : Number(r.user_grade),
            status: r.status,
            is_stale_version,
            created_at: Number(r.created_at),
        };
    }
}
