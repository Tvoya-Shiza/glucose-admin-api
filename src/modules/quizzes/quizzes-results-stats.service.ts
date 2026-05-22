import { Injectable, Logger } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import type { Redis } from 'ioredis';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { PrismaService } from '../../prisma/prisma.service';
import { ANALYTICS_TTL_SECONDS, buildAnalyticsCacheKey } from '../analytics/utils/analytics-cache';
import { ResultsStatsDto } from './dto/results-stats.dto';
import { buildResultsWhere } from './quizzes-results-where';

/**
 * QZ-10 — admin/curator/teacher analytics for the /quizzes/results audit page.
 *
 * Returns totals + a daily attempts-by-status trend + top quizzes + top groups
 * for the currently filtered window. Reuses the same WHERE composition (badge
 * resolution, group_id narrowing, RBAC scoping) as the list endpoint via
 * buildResultsWhere — so a curator's stats and their list always agree.
 *
 * Date-range posture:
 *   - default_from = now - 30d when caller omits date_from
 *   - default_to   = now when caller omits date_to
 *   - clamp to max 90-day window (date_from = max(date_from, date_to - 90d))
 *   - bucket: 'day' always.
 *
 * Cache:
 *   - 5 min TTL via buildAnalyticsCacheKey('quiz-results-stats', ...).
 *   - Same disjoint-namespace pattern as the dashboard analytics surfaces.
 */

const SEC_DAY = 24 * 3600;
const MAX_WINDOW_DAYS = 90;
const TOP_N = 10;

export interface ResultsStatsTotals {
    total: number;
    passed: number;
    failed: number;
    waiting: number;
    /** passed / (passed + failed); 0 when denominator is 0. */
    pass_rate: number;
    /** Mean over non-null user_grade; null when no grade rows exist. */
    avg_grade: number | null;
    unique_students: number;
}

export interface DailyTrendPoint {
    /** 'YYYY-MM-DD' (UTC). */
    date: string;
    passed: number;
    failed: number;
    waiting: number;
}

export interface TopQuizRow {
    quiz_id: number;
    title_kz: string | null;
    attempt_count: number;
    pass_rate: number;
}

export interface TopGroupRow {
    group_id: number;
    name: string;
    attempt_count: number;
    pass_rate: number;
}

export interface ResultsStatsResponse {
    totals: ResultsStatsTotals;
    daily_trend: DailyTrendPoint[];
    top_quizzes: TopQuizRow[];
    top_groups: TopGroupRow[];
    bucket: 'day';
    /** Applied date_from after default + clamp (Unix sec). */
    date_from: number;
    /** Applied date_to after default (Unix sec). */
    date_to: number;
    snapshot_at: number;
}

@Injectable()
export class QuizzesResultsStatsService {
    private readonly logger = new Logger(QuizzesResultsStatsService.name);

    constructor(
        private readonly prisma: PrismaService,
        @InjectRedis() private readonly redis: Redis,
    ) {}

    public async compute(actor: ScopeActor, raw: ResultsStatsDto): Promise<ResultsStatsResponse> {
        const now = Math.floor(Date.now() / 1000);
        const applied = this.applyDateDefaults(raw, now);

        const cacheKey = buildAnalyticsCacheKey('quiz-results-stats', actor.role_name, actor.id, { ...applied });
        const cached = await this.safeGet(cacheKey);
        if (cached) return cached;

        const result = await this.computeUncached(actor, applied, now);
        await this.safeSet(cacheKey, result);
        return result;
    }

    /**
     * Apply default range + clamp the window. Mutates a copy so the cache-key
     * filter blob captures the *applied* range (different requests with the
     * same clamped window share a cache slot).
     */
    private applyDateDefaults(raw: ResultsStatsDto, now: number): Required<Pick<ResultsStatsDto, 'date_from' | 'date_to'>> & ResultsStatsDto {
        const date_to = typeof raw.date_to === 'number' ? raw.date_to : now;
        let date_from = typeof raw.date_from === 'number' ? raw.date_from : date_to - 30 * SEC_DAY;
        const minFrom = date_to - MAX_WINDOW_DAYS * SEC_DAY;
        if (date_from < minFrom) date_from = minFrom;
        return { ...raw, date_from, date_to };
    }

    private async computeUncached(
        actor: ScopeActor,
        filters: ResultsStatsDto & { date_from: number; date_to: number },
        now: number,
    ): Promise<ResultsStatsResponse> {
        const { where, shortCircuit } = await buildResultsWhere(actor, filters, this.prisma);
        if (shortCircuit) {
            return this.emptyResponse(filters.date_from, filters.date_to, now);
        }

        // Totals: one transaction with 4 counts.
        const [total, passed, failed, waiting] = await this.prisma.$transaction([
            this.prisma.quizResult.count({ where }),
            this.prisma.quizResult.count({ where: { ...where, status: 'passed' } }),
            this.prisma.quizResult.count({ where: { ...where, status: 'failed' } }),
            this.prisma.quizResult.count({ where: { ...where, status: 'waiting' } }),
        ]);

        const resolved = passed + failed;
        const pass_rate = resolved > 0 ? passed / resolved : 0;

        // Pull (created_at, status, user_id, user_grade) once — covers daily_trend,
        // unique_students, avg_grade, and top_groups (user_id list).
        const rawRows = await this.prisma.quizResult.findMany({
            where,
            select: { created_at: true, status: true, user_id: true, user_grade: true, quiz_id: true },
        });

        const daily_trend = bucketizeDailyByStatus(rawRows, filters.date_from, filters.date_to);

        const userIds = new Set<number>();
        let gradeSum = 0;
        let gradeCount = 0;
        for (const r of rawRows) {
            userIds.add(r.user_id);
            if (r.user_grade != null) {
                gradeSum += Number(r.user_grade);
                gradeCount += 1;
            }
        }
        const totals: ResultsStatsTotals = {
            total,
            passed,
            failed,
            waiting,
            pass_rate,
            avg_grade: gradeCount > 0 ? gradeSum / gradeCount : null,
            unique_students: userIds.size,
        };

        const top_quizzes = await this.computeTopQuizzes(rawRows);
        const top_groups = actor.role_name === 'teacher' ? [] : await this.computeTopGroups(rawRows);

        return {
            totals,
            daily_trend,
            top_quizzes,
            top_groups,
            bucket: 'day',
            date_from: filters.date_from,
            date_to: filters.date_to,
            snapshot_at: now,
        };
    }

    private async computeTopQuizzes(
        rows: Array<{ quiz_id: number; status: string }>,
    ): Promise<TopQuizRow[]> {
        if (rows.length === 0) return [];

        // Bucket attempts + passed/failed counts by quiz_id in memory.
        const byQuiz = new Map<number, { attempts: number; passed: number; failed: number }>();
        for (const r of rows) {
            const cur = byQuiz.get(r.quiz_id) ?? { attempts: 0, passed: 0, failed: 0 };
            cur.attempts += 1;
            if (r.status === 'passed') cur.passed += 1;
            if (r.status === 'failed') cur.failed += 1;
            byQuiz.set(r.quiz_id, cur);
        }

        const ranked = Array.from(byQuiz.entries())
            .sort((a, b) => b[1].attempts - a[1].attempts)
            .slice(0, TOP_N);
        if (ranked.length === 0) return [];

        const quizIds = ranked.map(([id]) => id);
        const quizzes = await this.prisma.quizzes.findMany({
            where: { id: { in: quizIds } },
            select: {
                id: true,
                translations: { select: { locale: true, title: true } },
            },
        });
        const titleByQuiz = new Map<number, string | null>();
        for (const q of quizzes) {
            const kz = q.translations.find((t) => t.locale === 'kz')?.title ?? null;
            titleByQuiz.set(Number(q.id), kz);
        }

        return ranked.map(([quiz_id, agg]) => {
            const resolved = agg.passed + agg.failed;
            return {
                quiz_id,
                title_kz: titleByQuiz.get(quiz_id) ?? null,
                attempt_count: agg.attempts,
                pass_rate: resolved > 0 ? agg.passed / resolved : 0,
            };
        });
    }

    private async computeTopGroups(
        rows: Array<{ user_id: number; status: string }>,
    ): Promise<TopGroupRow[]> {
        if (rows.length === 0) return [];

        const userIds = Array.from(new Set(rows.map((r) => r.user_id)));
        if (userIds.length === 0) return [];

        // Pull user→group memberships for the users in scope, then bucket
        // each row by every group its user belongs to (a user can be in many
        // groups; counting once per (row, group) is the right interpretation
        // for "top groups by attempts").
        const memberships = await this.prisma.groupUser.findMany({
            where: { user_id: { in: userIds } },
            select: {
                user_id: true,
                group: { select: { id: true, name: true } },
            },
        });
        if (memberships.length === 0) return [];

        const groupsByUser = new Map<number, Array<{ id: number; name: string }>>();
        for (const m of memberships) {
            const arr = groupsByUser.get(m.user_id) ?? [];
            arr.push({ id: m.group.id, name: m.group.name });
            groupsByUser.set(m.user_id, arr);
        }

        const byGroup = new Map<number, { name: string; attempts: number; passed: number; failed: number }>();
        for (const r of rows) {
            const groups = groupsByUser.get(r.user_id);
            if (!groups) continue;
            for (const g of groups) {
                const cur = byGroup.get(g.id) ?? { name: g.name, attempts: 0, passed: 0, failed: 0 };
                cur.attempts += 1;
                if (r.status === 'passed') cur.passed += 1;
                if (r.status === 'failed') cur.failed += 1;
                byGroup.set(g.id, cur);
            }
        }

        return Array.from(byGroup.entries())
            .sort((a, b) => b[1].attempts - a[1].attempts)
            .slice(0, TOP_N)
            .map(([group_id, agg]) => {
                const resolved = agg.passed + agg.failed;
                return {
                    group_id,
                    name: agg.name,
                    attempt_count: agg.attempts,
                    pass_rate: resolved > 0 ? agg.passed / resolved : 0,
                };
            });
    }

    private emptyResponse(date_from: number, date_to: number, snapshot_at: number): ResultsStatsResponse {
        return {
            totals: { total: 0, passed: 0, failed: 0, waiting: 0, pass_rate: 0, avg_grade: null, unique_students: 0 },
            daily_trend: bucketizeDailyByStatus([], date_from, date_to),
            top_quizzes: [],
            top_groups: [],
            bucket: 'day',
            date_from,
            date_to,
            snapshot_at,
        };
    }

    private async safeGet(key: string): Promise<ResultsStatsResponse | null> {
        try {
            const cached = await this.redis.get(key);
            if (!cached) return null;
            return JSON.parse(cached) as ResultsStatsResponse;
        } catch (err) {
            this.logger.warn(`Redis GET failed for ${key}: ${(err as Error).message}`);
            return null;
        }
    }

    private async safeSet(key: string, value: ResultsStatsResponse): Promise<void> {
        try {
            await this.redis.set(key, JSON.stringify(value), 'EX', ANALYTICS_TTL_SECONDS);
        } catch (err) {
            this.logger.warn(`Redis SET failed for ${key}: ${(err as Error).message}`);
        }
    }
}

function startOfDayUtc(unixSec: number): number {
    const d = new Date(unixSec * 1000);
    return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000);
}

function formatYYYYMMDD(unixSec: number): string {
    const d = new Date(unixSec * 1000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function bucketizeDailyByStatus(
    rows: Array<{ created_at: number; status: string }>,
    fromUnixSec: number,
    toUnixSec: number,
): DailyTrendPoint[] {
    const buckets: DailyTrendPoint[] = [];
    let cursor = startOfDayUtc(fromUnixSec);
    const end = toUnixSec;
    while (cursor <= end) {
        const next = cursor + SEC_DAY;
        const day = formatYYYYMMDD(cursor);
        let passed = 0;
        let failed = 0;
        let waiting = 0;
        for (const r of rows) {
            if (r.created_at < cursor || r.created_at >= next) continue;
            if (r.status === 'passed') passed += 1;
            else if (r.status === 'failed') failed += 1;
            else if (r.status === 'waiting') waiting += 1;
        }
        buckets.push({ date: day, passed, failed, waiting });
        cursor = next;
    }
    return buckets;
}
