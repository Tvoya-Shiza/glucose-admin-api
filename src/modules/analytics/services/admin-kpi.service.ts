import { Injectable, Logger } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import type { Redis } from 'ioredis';
import type { ScopeActor } from '../../../common/scoping/scope.types';
import { PrismaService } from '../../../prisma/prisma.service';
import { AnalyticsQueryDto } from '../dto/analytics-query.dto';
import { ANALYTICS_TTL_SECONDS, buildAnalyticsCacheKey } from '../utils/analytics-cache';

/**
 * Phase 9 ANL-01 (D-11, D-14, D-15, D-16) — admin KPI dashboard.
 *
 * Surfaces 7 KPIs + 12-month revenue trend + 30-day completion trend, cached
 * for 5 minutes by (role, actor_id, filter_hash) via buildAnalyticsCacheKey.
 *
 * Schema-truth notes (verified against glucose-admin-api/prisma/schema.prisma):
 *   - User.last_activity is `DateTime?` (nullable) — DAU + 7d active uses
 *     `gte: new Date((now - WINDOW_SEC) * 1000)`, NOT a Unix-Int comparison.
 *   - User.deleted_at is `Int?` (Unix sec); `null` = active user. Total user
 *     count filters `deleted_at: null` to mirror the behavior of the user list
 *     endpoints in Phase 3.
 *   - QuizResult.created_at is `Int` (Unix sec); QuizResult.status is the
 *     `QuizResultStatus` enum with values `waiting | passed | failed`
 *     (schema:27-31). Completion-rate denominator excludes `waiting` because
 *     those attempts haven't resolved yet.
 *   - KaspiPayment.txn_date is `Int? @db.UnsignedInt` (Unix sec, nullable).
 *     Revenue queries filter `txn_date IS NOT NULL` AND `status: { not: null }`
 *     — the conservative v1 stance per Plan 04 <read_first> (any non-null
 *     status = recorded payment). KaspiPayment has NO created_at column.
 *   - KaspiPayment.sum is `Decimal(15,3)`. Sum-by-Number is precision-safe for
 *     KZT volumes (millions/billions << MAX_SAFE_INTEGER); v2 may switch to
 *     BigInt arithmetic if precision claims demand it.
 *   - There is NO clean per-Sale "completed" signal in the schema — CourseLearning
 *     is a thin (user_id, file_id) pivot WITHOUT a `completed_at` column.
 *     `completion_rate_30d` is therefore aliased to `test_completion_rate_30d`
 *     as a v1 proxy (D-11 lists "course completion rate" but the planner
 *     flagged this in <read_first> as a Claude's-Discretion fallback).
 *
 * Aggregation strategy:
 *   - User counts via `prisma.user.count` ×3 inside `$transaction` (one-shot).
 *   - QuizResult counts via `prisma.quizResult.count` ×2 inside `$transaction`.
 *   - Revenue (current month + 12-month trend): `findMany` selecting only
 *     `txn_date` + `sum`, then bucketize in-memory. Acceptable because rows are
 *     bounded (12 months × Kaspi volume) and the 5-minute cache amortizes cost.
 *     Prisma `groupBy` cannot bucketize on a derived month key without raw SQL,
 *     and raw SQL is harder to keep schema-truth across MySQL collations.
 *   - Completion trend (30 daily buckets): same approach — findMany + in-memory
 *     bucketize.
 */

export interface MonthlyRevenuePoint {
    month: string; // 'YYYY-MM'
    revenue: string; // Decimal-as-string
    payment_count: number;
}

export interface CompletionRatePoint {
    date: string; // 'YYYY-MM-DD'
    completion_rate: number; // 0..1
    attempts: number;
}

export interface AdminKpiResponse {
    total_users: number;
    active_users_24h: number;
    active_users_7d: number;
    completion_rate_30d: number;
    test_attempts_30d: number;
    test_completion_rate_30d: number;
    revenue_current_month: string;
    revenue_trend_12m: MonthlyRevenuePoint[];
    completion_trend_30d: CompletionRatePoint[];
    snapshot_at: number;
}

@Injectable()
export class AdminKpiService {
    private readonly logger = new Logger(AdminKpiService.name);

    private static readonly SEC_24H = 24 * 3600;
    private static readonly SEC_7D = 7 * AdminKpiService.SEC_24H;
    private static readonly SEC_30D = 30 * AdminKpiService.SEC_24H;

    constructor(
        private readonly prisma: PrismaService,
        @InjectRedis() private readonly redis: Redis,
    ) {}

    public async compute(actor: ScopeActor, query: AnalyticsQueryDto): Promise<AdminKpiResponse> {
        const cacheKey = buildAnalyticsCacheKey('admin-kpi', actor.role_name, actor.id, { ...query });
        const cached = await this.safeGet(cacheKey);
        if (cached) return cached;

        const result = await this.computeUncached();
        await this.safeSet(cacheKey, result);
        return result;
    }

    private async computeUncached(): Promise<AdminKpiResponse> {
        const now = Math.floor(Date.now() / 1000);

        // 1-3. User counts: total + 24h active + 7d active.
        // last_activity is DateTime? — comparison uses Date object derived from
        // the desired Unix-second window start.
        const [total_users, active_24h, active_7d] = await this.prisma.$transaction([
            this.prisma.user.count({ where: { deleted_at: null } }),
            this.prisma.user.count({
                where: {
                    deleted_at: null,
                    last_activity: { gte: new Date((now - AdminKpiService.SEC_24H) * 1000) },
                },
            }),
            this.prisma.user.count({
                where: {
                    deleted_at: null,
                    last_activity: { gte: new Date((now - AdminKpiService.SEC_7D) * 1000) },
                },
            }),
        ]);

        // 4-5. Test stats over last 30 days.
        // QuizResult.status enum: waiting | passed | failed.
        // - test_attempts_30d: total resolved + waiting attempts in window.
        // - test_completion_rate_30d: passed / (passed + failed) — `waiting`
        //   excluded so partial-attempt windows don't dilute the rate.
        const window30Start = now - AdminKpiService.SEC_30D;
        const [attemptCount, passedCount, failedCount] = await this.prisma.$transaction([
            this.prisma.quizResult.count({ where: { created_at: { gte: window30Start } } }),
            this.prisma.quizResult.count({ where: { created_at: { gte: window30Start }, status: 'passed' } }),
            this.prisma.quizResult.count({ where: { created_at: { gte: window30Start }, status: 'failed' } }),
        ]);
        const resolvedCount = passedCount + failedCount;
        const test_completion_rate_30d = resolvedCount > 0 ? passedCount / resolvedCount : 0;

        // 6. completion_rate_30d — v1 proxy: same as test_completion_rate_30d
        // because CourseLearning has no `completed_at` column (schema:1037-1049).
        // Revisit when a per-Sale completion signal lands. Documented in JSDoc.
        const completion_rate_30d = test_completion_rate_30d;

        // 7. revenue_current_month — sum of KaspiPayment.sum where txn_date in
        // [monthStart, nextMonthStart). UTC boundaries for v1; Asia/Almaty
        // adjustment can come in a follow-up if reconciliation surfaces edge
        // cases at month-rollover.
        const monthStart = startOfMonthUtc(now);
        const nextMonthStart = nextMonthStartUtc(monthStart);
        const revenueAgg = await this.prisma.kaspiPayment.aggregate({
            where: {
                txn_date: { gte: monthStart, lt: nextMonthStart },
                status: { not: null }, // any recorded status — see <read_first>
            },
            _sum: { sum: true },
        });
        const revenue_current_month = (revenueAgg._sum.sum ?? '0').toString();

        // 8. revenue_trend_12m — 12 ascending monthly buckets ending at the
        // current month. We compute the start-of-month 12 months ago and select
        // the (txn_date, sum) tuples in the [trend12m_start, nextMonthStart)
        // window, then bucketize in-memory.
        const trend12m_start = startOfMonthUtc(now - 365 * AdminKpiService.SEC_24H);
        const allTxnsIn12m = await this.prisma.kaspiPayment.findMany({
            where: {
                txn_date: { gte: trend12m_start, lt: nextMonthStart },
                status: { not: null },
            },
            select: { txn_date: true, sum: true },
        });
        const revenue_trend_12m = bucketizeMonthly(allTxnsIn12m, trend12m_start, monthStart);

        // 9. completion_trend_30d — 30 ascending daily buckets ending today.
        // Pull (created_at, status) for QuizResult rows in window, bucketize.
        const trend30d_start = startOfDayUtc(now - 30 * AdminKpiService.SEC_24H);
        const allQuizResultsIn30d = await this.prisma.quizResult.findMany({
            where: { created_at: { gte: trend30d_start } },
            select: { created_at: true, status: true },
        });
        const completion_trend_30d = bucketizeDaily(allQuizResultsIn30d, trend30d_start, now);

        return {
            total_users,
            active_users_24h: active_24h,
            active_users_7d: active_7d,
            completion_rate_30d,
            test_attempts_30d: attemptCount,
            test_completion_rate_30d,
            revenue_current_month,
            revenue_trend_12m,
            completion_trend_30d,
            snapshot_at: now,
        };
    }

    private async safeGet(key: string): Promise<AdminKpiResponse | null> {
        try {
            const cached = await this.redis.get(key);
            if (!cached) return null;
            return JSON.parse(cached) as AdminKpiResponse;
        } catch (err) {
            this.logger.warn(`Redis GET failed for ${key}: ${(err as Error).message}`);
            return null;
        }
    }

    private async safeSet(key: string, value: AdminKpiResponse): Promise<void> {
        try {
            await this.redis.set(key, JSON.stringify(value), 'EX', ANALYTICS_TTL_SECONDS);
        } catch (err) {
            this.logger.warn(`Redis SET failed for ${key}: ${(err as Error).message}`);
        }
    }
}

// ---------- Date / bucketize helpers (kept here for v1; promote to utils if reused) ----------

function startOfMonthUtc(unixSec: number): number {
    const d = new Date(unixSec * 1000);
    return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000);
}

function nextMonthStartUtc(monthStartUnixSec: number): number {
    const d = new Date(monthStartUnixSec * 1000);
    const nextMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    return Math.floor(nextMonth.getTime() / 1000);
}

function startOfDayUtc(unixSec: number): number {
    const d = new Date(unixSec * 1000);
    return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000);
}

function bucketizeMonthly(
    rows: Array<{ txn_date: number | null; sum: { toString: () => string } }>,
    startUnixSec: number,
    currentMonthStartUnixSec: number,
): MonthlyRevenuePoint[] {
    const buckets: MonthlyRevenuePoint[] = [];
    let cursor = startUnixSec;
    while (cursor <= currentMonthStartUnixSec) {
        const next = nextMonthStartUtc(cursor);
        const monthLabel = formatYYYYMM(cursor);
        const inBucket = rows.filter((r) => r.txn_date !== null && r.txn_date >= cursor && r.txn_date < next);
        // Decimal -> Number for in-memory sum: KZT volumes are well below
        // MAX_SAFE_INTEGER (2^53-1 ~= 9 quadrillion). Toll documented on the
        // service-level JSDoc. T-09-04-06.
        const totalRev = inBucket.reduce((acc, r) => acc + Number(r.sum.toString()), 0);
        buckets.push({ month: monthLabel, revenue: totalRev.toFixed(3), payment_count: inBucket.length });
        cursor = next;
    }
    return buckets;
}

function bucketizeDaily(
    rows: Array<{ created_at: number; status: string }>,
    startUnixSec: number,
    nowUnixSec: number,
): CompletionRatePoint[] {
    const SEC_24H = 24 * 3600;
    const buckets: CompletionRatePoint[] = [];
    let cursor = startUnixSec;
    while (cursor <= nowUnixSec) {
        const next = cursor + SEC_24H;
        const dayLabel = formatYYYYMMDD(cursor);
        const inBucket = rows.filter((r) => r.created_at >= cursor && r.created_at < next);
        const passed = inBucket.filter((r) => r.status === 'passed').length;
        const failed = inBucket.filter((r) => r.status === 'failed').length;
        const resolved = passed + failed;
        const rate = resolved > 0 ? passed / resolved : 0;
        buckets.push({ date: dayLabel, completion_rate: rate, attempts: inBucket.length });
        cursor = next;
    }
    return buckets;
}

function formatYYYYMM(unixSec: number): string {
    const d = new Date(unixSec * 1000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function formatYYYYMMDD(unixSec: number): string {
    const d = new Date(unixSec * 1000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
