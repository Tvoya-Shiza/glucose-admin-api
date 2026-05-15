import { Injectable, Logger } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import type { Redis } from 'ioredis';
import type { ScopeActor } from '../../../common/scoping/scope.types';
import { PrismaService } from '../../../prisma/prisma.service';
import { AnalyticsQueryDto } from '../dto/analytics-query.dto';
import { ANALYTICS_TTL_SECONDS, buildAnalyticsCacheKey } from '../utils/analytics-cache';

/**
 * Phase 9 ANL-03 (D-11, D-14, D-19, D-22) — teacher dashboard.
 *
 * Returns the teacher's own webinars (with student count via Sale entitlement
 * + recent quiz-results count) plus the pending grading queue
 * (WebinarAssignmentHistory.status='pending' where instructor_id == actor.id,
 * cap 50 ordered oldest-first). Cached for 5 minutes by (role, actor_id) tuple.
 *
 * Schema-truth (verified against glucose-admin-api/prisma/schema.prisma:
 * 817-861, 1112-1127, 715-746):
 *   - Webinar.teacher_id is `Int @db.UnsignedInt` (NOT NULL) — the teacher-id
 *     scope key. Filtering by `teacher_id: actor.id` returns only this
 *     teacher's webinars (T-09-04-01 mitigation).
 *   - Webinar.deleted_at is `Int?` (Unix sec); null = active.
 *   - WebinarTranslations relation field name on Webinar is `translations`
 *     (schema:836). RU title (D-25 — admin canonical locale) is selected with
 *     `where: { locale: 'ru' }, take: 1`.
 *   - Sale = entitlement (NO WebinarUser model in schema). `student_count` =
 *     count of Sale rows with `webinar_id == w.id` AND `refund_at IS NULL`,
 *     computed via `_count: { sales: { where: { refund_at: null } } }`.
 *   - WebinarAssignmentHistory.instructor_id is `Int @db.UnsignedInt` (NOT NULL)
 *     — the "instructor" in the schema is the teacher in glucose-api parlance.
 *     Pending queue scoped by `instructor_id: actor.id`.
 *   - WebinarAssignmentHistory.status enum: pending | passed | not_passed |
 *     not_submitted (schema:158-163). 'pending' is the grading queue.
 *   - WebinarAssignmentHistory.created_at is `BigInt @db.UnsignedBigInt`
 *     (schema:1119). Unix seconds always fit MAX_SAFE_INTEGER, so we collapse
 *     to `number` at the boundary via `Number(bigint.toString())` — this is a
 *     well-tested precision-safe pattern used elsewhere in admin-api.
 *   - User.full_name is `String?` (nullable, schema:210).
 *
 * Admin pivot (D-19): admin requesting this endpoint with as_role=teacher
 * still queries `teacher_id: actor.id` — they see THEIR webinars, not a
 * pivoted teacher's. UX label only (T-09-04-03).
 *
 * Bounds: 100 webinars + 50 pending assignments per request via `take`. Both
 * are operationally generous; pending_assignments_total signals truncation
 * (T-09-04-04 accepted).
 */

export interface TeacherOverviewCourse {
    id: number;
    title: string;
    student_count: number;
    recent_results_7d: number;
}

export interface TeacherOverviewPendingAssignment {
    id: number;
    student_id: number;
    student_full_name: string | null;
    assignment_id: number;
    created_at: number;
}

export interface TeacherOverviewResponse {
    courses: TeacherOverviewCourse[];
    pending_assignments: TeacherOverviewPendingAssignment[];
    pending_assignments_total: number;
    snapshot_at: number;
}

@Injectable()
export class TeacherOverviewService {
    private readonly logger = new Logger(TeacherOverviewService.name);

    private static readonly SEC_7D = 7 * 24 * 3600;
    private static readonly WEBINAR_TAKE = 100;
    private static readonly PENDING_TAKE = 50;

    constructor(
        private readonly prisma: PrismaService,
        @InjectRedis() private readonly redis: Redis,
    ) {}

    public async compute(actor: ScopeActor, _query: AnalyticsQueryDto): Promise<TeacherOverviewResponse> {
        const cacheKey = buildAnalyticsCacheKey('teacher-overview', actor.role_name, actor.id, {});
        const cached = await this.safeGet(cacheKey);
        if (cached) return cached;

        const result = await this.computeUncached(actor);
        await this.safeSet(cacheKey, result);
        return result;
    }

    private async computeUncached(actor: ScopeActor): Promise<TeacherOverviewResponse> {
        const now = Math.floor(Date.now() / 1000);
        const recent7dStart = now - TeacherOverviewService.SEC_7D;

        // Own webinars + denormalized counts.
        // _count.sales filtered by `refund_at: null` = active entitlements
        // (Sale = entitlement; no WebinarUser).
        // quizzes._count.results in last 7 days = recent activity proxy.
        const webinars = await this.prisma.webinar.findMany({
            where: { teacher_id: actor.id, deleted_at: null },
            select: {
                id: true,
                translations: {
                    where: { locale: 'kz' },
                    select: { title: true },
                    take: 1,
                },
                _count: {
                    select: {
                        sales: { where: { refund_at: null } },
                    },
                },
                quizzes: {
                    select: {
                        quiz: {
                            select: {
                                _count: {
                                    select: {
                                        results: { where: { created_at: { gte: recent7dStart } } },
                                    },
                                },
                            },
                        },
                    },
                },
            },
            take: TeacherOverviewService.WEBINAR_TAKE,
        });

        const courses: TeacherOverviewCourse[] = webinars.map((w) => ({
            id: w.id,
            title: w.translations[0]?.title ?? '',
            student_count: w._count.sales,
            recent_results_7d: w.quizzes.reduce((acc, wq) => acc + (wq.quiz?._count.results ?? 0), 0),
        }));

        // Pending grading queue scoped by instructor_id (T-09-04-01).
        // Ordered oldest-first because grading queues are FIFO; admin/teacher
        // wants to see the longest-waiting submission at the top.
        const [pending_assignments_total, pendingRows] = await this.prisma.$transaction([
            this.prisma.webinarAssignmentHistory.count({
                where: { instructor_id: actor.id, status: 'pending' },
            }),
            this.prisma.webinarAssignmentHistory.findMany({
                where: { instructor_id: actor.id, status: 'pending' },
                select: {
                    id: true,
                    student_id: true,
                    student: { select: { full_name: true } },
                    assignment_id: true,
                    created_at: true,
                },
                orderBy: { created_at: 'asc' },
                take: TeacherOverviewService.PENDING_TAKE,
            }),
        ]);

        const pending_assignments: TeacherOverviewPendingAssignment[] = pendingRows.map((a) => ({
            id: a.id,
            student_id: a.student_id,
            student_full_name: a.student.full_name ?? null,
            assignment_id: a.assignment_id,
            // BigInt -> number: Unix sec well within MAX_SAFE_INTEGER.
            created_at: Number(a.created_at.toString()),
        }));

        return { courses, pending_assignments, pending_assignments_total, snapshot_at: now };
    }

    private async safeGet(key: string): Promise<TeacherOverviewResponse | null> {
        try {
            const cached = await this.redis.get(key);
            if (!cached) return null;
            return JSON.parse(cached) as TeacherOverviewResponse;
        } catch (err) {
            this.logger.warn(`Redis GET failed for ${key}: ${(err as Error).message}`);
            return null;
        }
    }

    private async safeSet(key: string, value: TeacherOverviewResponse): Promise<void> {
        try {
            await this.redis.set(key, JSON.stringify(value), 'EX', ANALYTICS_TTL_SECONDS);
        } catch (err) {
            this.logger.warn(`Redis SET failed for ${key}: ${(err as Error).message}`);
        }
    }
}
