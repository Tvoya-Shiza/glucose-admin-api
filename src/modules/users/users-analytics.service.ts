import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { buildScopeWhere } from '../../common/scoping/scope.helper';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { PrismaService } from '../../prisma/prisma.service';
import type { UsersAnalyticsQueryDto, UsersAnalyticsResponseDto } from './dto/users-analytics.dto';
import { USER_SCOPE_RULES } from './users.scope';

/**
 * Read-only KPI surface for the users page: totals, status/role split, and the
 * registration trend over a configurable window.
 *
 * Scope (D-21): re-applies USER_SCOPE_RULES so curators/teachers only see counts
 * inside their data perimeter. Forgetting this leaks aggregate signals about
 * out-of-scope cohorts (T-03-11 family).
 *
 * Bucketing: `created_at` is `Int` (Unix seconds). Day buckets snap to UTC
 * midnight; week buckets snap to UTC Monday; month buckets snap to UTC
 * first-of-month. We pull (created_at) tuples and bucketize in-memory rather
 * than fight Prisma raw SQL across MySQL collations — same compromise the
 * admin-kpi service makes for the 30-day completion trend.
 *
 * Caching is intentionally NOT added here in v1 — registrations data is
 * relatively cheap and the user expects fresh numbers as filters change. If
 * volume grows we can bolt on the same Redis surface as `analytics/admin-kpi`.
 */
@Injectable()
export class UsersAnalyticsService {
    private readonly logger = new Logger(UsersAnalyticsService.name);

    private static readonly SEC_DAY = 86_400;
    private static readonly SEC_WEEK = 7 * 86_400;
    private static readonly SEC_30D = 30 * 86_400;
    private static readonly MAX_RANGE_SEC = 366 * 5 * 86_400; // 5 years guardrail for custom

    constructor(private readonly prisma: PrismaService) {}

    public async compute(actor: ScopeActor, q: UsersAnalyticsQueryDto): Promise<UsersAnalyticsResponseDto> {
        const now = Math.floor(Date.now() / 1000);
        const range = q.range ?? '30d';

        let from: number;
        let to: number;
        if (range === 'custom') {
            if (typeof q.from !== 'number' || typeof q.to !== 'number') {
                throw new BadRequestException('analytics.custom_range_requires_from_to');
            }
            if (q.from >= q.to) {
                throw new BadRequestException('analytics.from_must_precede_to');
            }
            if (q.to - q.from > UsersAnalyticsService.MAX_RANGE_SEC) {
                throw new BadRequestException('analytics.range_too_wide');
            }
            from = q.from;
            to = q.to;
        } else {
            const days = range === '7d' ? 7 : range === '30d' ? 30 : range === '90d' ? 90 : 365;
            from = now - days * UsersAnalyticsService.SEC_DAY;
            to = now;
        }

        const bucket = q.bucket ?? pickBucket(to - from);
        const scopeWhere = buildScopeWhere(actor, USER_SCOPE_RULES);
        const baseWhere: any = { deleted_at: null, ...scopeWhere };

        // 1. Totals: total | new-in-range | active-30d.
        // last_activity is `DateTime?` — compare with a Date object.
        const [total_users, new_users_in_range, active_users_30d] = await this.prisma.$transaction([
            this.prisma.user.count({ where: baseWhere }),
            this.prisma.user.count({ where: { ...baseWhere, created_at: { gte: from, lt: to } } }),
            this.prisma.user.count({
                where: {
                    ...baseWhere,
                    last_activity: { gte: new Date((now - UsersAnalyticsService.SEC_30D) * 1000) },
                },
            }),
        ]);

        // 2. by_status — three counts in one transaction.
        const [active, inactive, pending] = await this.prisma.$transaction([
            this.prisma.user.count({ where: { ...baseWhere, status: 'active' } }),
            this.prisma.user.count({ where: { ...baseWhere, status: 'inactive' } }),
            this.prisma.user.count({ where: { ...baseWhere, status: 'pending' } }),
        ]);

        // 3. by_role — groupBy + count. `baseWhere` is typed `any` (composed with the
        // scope fragment); Prisma's overloaded `groupBy` can't pick the right overload
        // through that, so we cast the args. Sorting happens post-hoc (5-role dataset).
        const roleGroups = (await this.prisma.user.groupBy({
            by: ['role_name'],
            where: baseWhere,
            _count: { _all: true },
        } as any)) as Array<{ role_name: string; _count: { _all: number } }>;
        const by_role = roleGroups
            .map((g) => ({ role_name: g.role_name, count: Number(g._count._all) }))
            .sort((a, b) => a.role_name.localeCompare(b.role_name));

        // 4. registrations — pull (created_at) tuples in window, bucketize.
        // Pull only the column we need; the index `idx_users_created_at` keeps this cheap.
        const rows = (await this.prisma.user.findMany({
            where: { ...baseWhere, created_at: { gte: from, lt: to } },
            select: { created_at: true },
        })) as Array<{ created_at: number }>;
        const registrations = bucketize(
            rows.map((r) => Number(r.created_at)),
            from,
            to,
            bucket,
        );

        return {
            totals: { total_users, new_users_in_range, active_users_30d },
            by_status: { active, inactive, pending },
            by_role,
            registrations,
            range: { from, to, bucket },
            generated_at: now,
        };
    }
}

function pickBucket(spanSec: number): 'day' | 'week' | 'month' {
    if (spanSec <= 120 * 86_400) return 'day';
    if (spanSec <= 400 * 86_400) return 'week';
    return 'month';
}

function bucketize(
    timestamps: number[],
    from: number,
    to: number,
    bucket: 'day' | 'week' | 'month',
): Array<{ bucket: number; count: number }> {
    const buckets: Array<{ bucket: number; count: number }> = [];
    let cursor = bucketStart(from, bucket);
    while (cursor < to) {
        const next = bucketNext(cursor, bucket);
        const count = timestamps.filter((t) => t >= cursor && t < next).length;
        buckets.push({ bucket: cursor, count });
        cursor = next;
    }
    return buckets;
}

function bucketStart(unixSec: number, bucket: 'day' | 'week' | 'month'): number {
    const d = new Date(unixSec * 1000);
    if (bucket === 'day') {
        return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000);
    }
    if (bucket === 'month') {
        return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000);
    }
    // Week — snap back to UTC Monday. Date.getUTCDay() returns 0 (Sun)..6 (Sat).
    const dayStart = Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000);
    const dow = d.getUTCDay(); // 0..6
    const offsetToMonday = ((dow + 6) % 7) * 86_400;
    return dayStart - offsetToMonday;
}

function bucketNext(unixSec: number, bucket: 'day' | 'week' | 'month'): number {
    if (bucket === 'day') return unixSec + 86_400;
    if (bucket === 'week') return unixSec + 7 * 86_400;
    const d = new Date(unixSec * 1000);
    return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000);
}
