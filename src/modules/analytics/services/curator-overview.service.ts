import { Injectable, Logger } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import type { Redis } from 'ioredis';
import type { ScopeActor } from '../../../common/scoping/scope.types';
import { PrismaService } from '../../../prisma/prisma.service';
import { AnalyticsQueryDto } from '../dto/analytics-query.dto';
import { ANALYTICS_TTL_SECONDS, buildAnalyticsCacheKey } from '../utils/analytics-cache';

/**
 * Phase 9 ANL-02 (D-11, D-14, D-19, D-22) — curator dashboard.
 *
 * Returns the actor's supervised groups, member count + active-members count
 * in window, plus a group-scoped quiz completion rate. Cached for 5 minutes by
 * (role, actor_id, window_days) tuple via buildAnalyticsCacheKey.
 *
 * Schema-truth (verified against glucose-admin-api/prisma/schema.prisma:312-326):
 *   - Group.supervisor_id is `Int? @db.UnsignedInt` (NULLABLE) — the curator-id
 *     scope key. Filtering by `supervisor_id: actor.id` only returns this
 *     curator's groups (T-09-04-01 mitigation — explicit per-query, no shared
 *     buildScopeWhere because the where shape is unique to this surface).
 *   - Group.status is `GroupStatus` enum: active | inactive (schema:185-188).
 *     v1 returns `active` only — admin can flip to view inactive in v2.
 *   - GroupUser pivot (schema:328-338) — `group._count.group_users` is the
 *     member count.
 *   - User.quiz_results relation: `User.quiz_results QuizResult[]`
 *     (schema:241).
 *   - QuizResult.status enum: waiting | passed | failed (schema:27-31).
 *     Completion rate uses `passed / (passed + failed)`; `waiting` excluded.
 *   - QuizResult.created_at is `Int` (Unix sec). Window filter uses Unix-Int
 *     gte comparison.
 *
 * Admin pivot (D-19 / T-09-04-03): admin requesting this endpoint with
 * as_role=curator still queries `supervisor_id: actor.id` — they see groups
 * THEY supervise. The pivot is a UX label, not an identity swap. RolesGuard
 * already gates the endpoint to admin + curator.
 *
 * v1 simplification: avg_progress aliases completion_rate because per-Sale /
 * per-CourseLearning progress signal isn't computable cleanly in the schema
 * (CourseLearning has no `completed_at` column; see admin-kpi.service.ts JSDoc).
 *
 * Bound: 100 groups + 200 quiz-results per member, both via `take`. Curators
 * with > 100 supervised groups see truncated data; full pagination deferred to
 * v2 (T-09-04-04 accepted).
 */

export interface CuratorOverviewGroup {
    id: number;
    name: string;
    member_count: number;
    avg_progress: number | null;
    active_members: number;
    completion_rate: number | null;
}

export interface CuratorOverviewResponse {
    window_days: number | 'all';
    groups: CuratorOverviewGroup[];
    snapshot_at: number;
}

@Injectable()
export class CuratorOverviewService {
    private readonly logger = new Logger(CuratorOverviewService.name);

    private static readonly DEFAULT_WINDOW_DAYS = 7;
    private static readonly GROUP_TAKE = 100;
    private static readonly QUIZ_RESULTS_PER_MEMBER_TAKE = 200;

    constructor(
        private readonly prisma: PrismaService,
        @InjectRedis() private readonly redis: Redis,
    ) {}

    public async compute(actor: ScopeActor, query: AnalyticsQueryDto): Promise<CuratorOverviewResponse> {
        const window_days: number | 'all' = query.window_all
            ? 'all'
            : (query.window_days ?? CuratorOverviewService.DEFAULT_WINDOW_DAYS);

        const cacheKey = buildAnalyticsCacheKey('curator-overview', actor.role_name, actor.id, { window_days });
        const cached = await this.safeGet(cacheKey);
        if (cached) return cached;

        const result = await this.computeUncached(actor, window_days);
        await this.safeSet(cacheKey, result);
        return result;
    }

    private async computeUncached(actor: ScopeActor, window_days: number | 'all'): Promise<CuratorOverviewResponse> {
        const now = Math.floor(Date.now() / 1000);
        // 'all' -> Unix epoch start; effectively no lower bound. Cheaper than
        // omitting the where clause because the index can still range-scan.
        const windowStart = window_days === 'all' ? 0 : now - window_days * 24 * 3600;

        // Curator scope (T-09-04-01): scope by supervisor_id == actor.id.
        // No buildScopeWhere shortcut — explicit per-query is more readable
        // for analytics aggregations, and ANALYTICS_SCOPE_RULES is intentionally
        // permissive (see analytics.scope.ts).
        const groups = await this.prisma.group.findMany({
            where: { supervisor_id: actor.id, status: 'active' },
            select: {
                id: true,
                name: true,
                _count: { select: { members: true } },
                members: {
                    select: {
                        user_id: true,
                        user: {
                            select: {
                                quiz_results: {
                                    where: { created_at: { gte: windowStart } },
                                    select: { status: true },
                                    take: CuratorOverviewService.QUIZ_RESULTS_PER_MEMBER_TAKE,
                                },
                            },
                        },
                    },
                },
            },
            take: CuratorOverviewService.GROUP_TAKE,
        });

        const result: CuratorOverviewGroup[] = groups.map((g) => {
            const memberCount = g._count.members;
            const allResults = g.members.flatMap((gu) => gu.user.quiz_results);
            const passed = allResults.filter((r) => r.status === 'passed').length;
            const failed = allResults.filter((r) => r.status === 'failed').length;
            const resolved = passed + failed;
            const completion_rate = resolved > 0 ? passed / resolved : null;
            const active_members = g.members.filter((gu) => gu.user.quiz_results.length > 0).length;
            // v1 alias — same value as completion_rate. Documented at top of file.
            const avg_progress = completion_rate;
            return {
                id: g.id,
                name: g.name,
                member_count: memberCount,
                avg_progress,
                active_members,
                completion_rate,
            };
        });

        return { window_days, groups: result, snapshot_at: now };
    }

    private async safeGet(key: string): Promise<CuratorOverviewResponse | null> {
        try {
            const cached = await this.redis.get(key);
            if (!cached) return null;
            return JSON.parse(cached) as CuratorOverviewResponse;
        } catch (err) {
            this.logger.warn(`Redis GET failed for ${key}: ${(err as Error).message}`);
            return null;
        }
    }

    private async safeSet(key: string, value: CuratorOverviewResponse): Promise<void> {
        try {
            await this.redis.set(key, JSON.stringify(value), 'EX', ANALYTICS_TTL_SECONDS);
        } catch (err) {
            this.logger.warn(`Redis SET failed for ${key}: ${(err as Error).message}`);
        }
    }
}
