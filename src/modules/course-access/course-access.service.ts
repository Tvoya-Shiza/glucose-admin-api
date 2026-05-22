import {
    BadRequestException,
    ConflictException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { PrismaService } from '../../prisma/prisma.service';
import type {
    CourseGrantRowDto,
    CreatedGrantDto,
    ExtendedGrantDto,
    GroupGrantsListResponseDto,
    RevokedGrantDto,
} from './dto/course-grant-row.dto';
import type {
    CourseAccessorRowDto,
    CourseAccessorsListResponseDto,
    CourseAccessorsSummaryDto,
} from './dto/course-accessor-row.dto';
import type { ExtendAccessDto } from './dto/extend-access.dto';
import type { GrantGroupAccessDto } from './dto/grant-group-access.dto';
import type { GrantUserAccessDto } from './dto/grant-user-access.dto';
import type { ListCourseAccessorsQueryDto } from './dto/list-course-accessors-query.dto';
import type { ListGroupGrantsQueryDto } from './dto/list-group-grants-query.dto';
import { CoursesProgressService } from '../courses/courses-progress.service';
import { normalizeKzPhone } from '../users/utils/normalize-phone';

/** Whole days from `nowSec` until `createdAt + accessDays * 86400`. Clamped to 0. */
function daysRemaining(createdAt: number, accessDays: number, nowSec: number): number {
    const expirySec = createdAt + accessDays * 86400;
    return Math.max(0, Math.floor((expirySec - nowSec) / 86400));
}

/**
 * Phase 18 — CourseAccessService.
 *
 * Owns CRUD-like operations on `sales` rows that represent course-access grants:
 *
 *   - grantUserAccess  → POST /users/:userId/course-access  (direct grant)
 *   - grantGroupAccess → POST /groups/:groupId/course-access (group grant)
 *   - extendAccess     → PATCH /sales/:saleId/access (recompute access_days)
 *   - revokeAccess     → DELETE /sales/:saleId/access (soft-revoke via refund_at)
 *   - listGroupGrants  → GET /groups/:groupId/course-access (Feature A list)
 *
 * Listing per-course accessors (Feature C — listCourseAccessors / summary)
 * lives here too but lands in PR-5 — left as a stub for now.
 *
 * Conflict handling: grant* methods do a `findFirst` for an active matching
 * grant before insert and throw 409 if found. There IS a race window between
 * the find and the create, but operator-visible — second request gets a 409
 * on retry, and the race surface is one-shot per (target, course). Mirror of
 * SchedulesService Phase 5 pattern.
 *
 * Audit: the controller attaches @Audit(...) decorators; the service does not
 * write audit rows directly. Service errors (NotFoundException, ConflictException,
 * BadRequestException) are captured by AuditInterceptor's catchError branch.
 *
 * Conversion `expires_at` → `access_days`:
 *   - null  → null (perpetual access)
 *   - <= sale.created_at → BadRequestException 'course_access.expires_in_past'
 *   - else → Math.ceil((expires_at - created_at) / 86400)
 *
 * RBAC: controller's @Roles('admin') already 403s non-admin for grant/revoke/extend.
 * listGroupGrants additionally allows curator (read-only — service does not narrow).
 */
@Injectable()
export class CourseAccessService {
    private readonly logger = new Logger(CourseAccessService.name);

    public static readonly DEFAULT_PAGE_SIZE = 50;
    public static readonly MAX_PAGE_SIZE = 200;

    constructor(
        private readonly prisma: PrismaService,
        private readonly progressService: CoursesProgressService,
    ) {}

    // -----------------------------------------------------------------------
    // grantUserAccess — direct (per-user) grant
    // -----------------------------------------------------------------------

    public async grantUserAccess(
        actor: ScopeActor,
        userId: number,
        dto: GrantUserAccessDto,
    ): Promise<CreatedGrantDto> {
        await this.assertUserExists(userId);
        await this.assertCourseExists(dto.webinar_id);

        const existing = await this.prisma.sale.findFirst({
            where: {
                buyer_id: userId,
                webinar_id: dto.webinar_id,
                refund_at: null,
                access_to_purchased_item: true,
            },
            select: { id: true },
        });
        if (existing) {
            throw new ConflictException('course_access.already_granted_to_user');
        }

        const now = Math.floor(Date.now() / 1000);
        const accessDays = this.toAccessDays(now, dto.expires_at ?? null);

        const sale = await this.prisma.sale.create({
            data: {
                buyer_id: userId,
                seller_id: actor.id,
                webinar_id: dto.webinar_id,
                type: 'webinar',
                payment_method: null,
                amount: '0',
                total_amount: '0',
                manual_added: true,
                access_to_purchased_item: true,
                access_days: accessDays,
                created_at: now,
            },
            select: { id: true, created_at: true, access_days: true },
        });

        return {
            sale_id: Number(sale.id),
            target_type: 'user',
            target_id: userId,
            webinar_id: dto.webinar_id,
            access_days: sale.access_days ?? null,
            expires_at: sale.access_days === null ? null : sale.created_at + sale.access_days * 86400,
            created_at: Number(sale.created_at),
        };
    }

    // -----------------------------------------------------------------------
    // grantGroupAccess — group-scoped grant
    // -----------------------------------------------------------------------

    public async grantGroupAccess(
        actor: ScopeActor,
        groupId: number,
        dto: GrantGroupAccessDto,
    ): Promise<CreatedGrantDto> {
        await this.assertGroupExists(groupId);
        await this.assertCourseExists(dto.webinar_id);

        const existing = await this.prisma.sale.findFirst({
            where: {
                group_id: groupId,
                webinar_id: dto.webinar_id,
                refund_at: null,
                access_to_purchased_item: true,
            },
            select: { id: true },
        });
        if (existing) {
            throw new ConflictException('course_access.already_granted_to_group');
        }

        const now = Math.floor(Date.now() / 1000);
        const accessDays = this.toAccessDays(now, dto.expires_at ?? null);

        const sale = await this.prisma.sale.create({
            data: {
                group_id: groupId,
                seller_id: actor.id,
                webinar_id: dto.webinar_id,
                type: 'webinar',
                payment_method: 'group_access',
                amount: '0',
                total_amount: '0',
                manual_added: true,
                access_to_purchased_item: true,
                access_days: accessDays,
                created_at: now,
            },
            select: { id: true, created_at: true, access_days: true },
        });

        return {
            sale_id: Number(sale.id),
            target_type: 'group',
            target_id: groupId,
            webinar_id: dto.webinar_id,
            access_days: sale.access_days ?? null,
            expires_at: sale.access_days === null ? null : sale.created_at + sale.access_days * 86400,
            created_at: Number(sale.created_at),
        };
    }

    // -----------------------------------------------------------------------
    // extendAccess — recompute access_days from new expires_at
    // -----------------------------------------------------------------------

    public async extendAccess(saleId: number, dto: ExtendAccessDto): Promise<ExtendedGrantDto> {
        // Atomic check-then-update: refund check + recompute happen inside
        // a transaction so concurrent extend+revoke cannot both succeed.
        const result = await this.prisma.$transaction(async (tx) => {
            const sale = await tx.sale.findUnique({
                where: { id: saleId },
                select: { id: true, refund_at: true, created_at: true, access_days: true },
            });
            if (!sale) {
                throw new NotFoundException('course_access.sale_not_found');
            }
            if (sale.refund_at !== null && sale.refund_at !== undefined) {
                throw new ConflictException('course_access.already_revoked');
            }
            const newAccessDays = this.toAccessDays(sale.created_at, dto.expires_at);
            const previous = sale.access_days ?? null;
            await tx.sale.update({
                where: { id: saleId },
                data: { access_days: newAccessDays },
            });
            return {
                sale_id: Number(sale.id),
                access_days: newAccessDays,
                expires_at: newAccessDays === null ? null : sale.created_at + newAccessDays * 86400,
                previous_access_days: previous,
            };
        });

        this.logger.log(
            `sale ${result.sale_id} access extended: ${result.previous_access_days} → ${result.access_days} days`,
        );
        return result;
    }

    // -----------------------------------------------------------------------
    // revokeAccess — soft-revoke via refund_at
    // -----------------------------------------------------------------------

    public async revokeAccess(saleId: number): Promise<RevokedGrantDto> {
        const result = await this.prisma.$transaction(async (tx) => {
            const sale = await tx.sale.findUnique({
                where: { id: saleId },
                select: { id: true, refund_at: true },
            });
            if (!sale) {
                throw new NotFoundException('course_access.sale_not_found');
            }
            if (sale.refund_at !== null && sale.refund_at !== undefined) {
                throw new ConflictException('course_access.already_revoked');
            }
            const now = Math.floor(Date.now() / 1000);
            await tx.sale.update({ where: { id: saleId }, data: { refund_at: now } });
            return { sale_id: Number(sale.id), refund_at: now };
        });

        this.logger.log(`sale ${result.sale_id} revoked at ${result.refund_at}`);
        return result;
    }

    // -----------------------------------------------------------------------
    // listGroupGrants — Feature A list
    // -----------------------------------------------------------------------

    public async listGroupGrants(
        groupId: number,
        query: ListGroupGrantsQueryDto,
    ): Promise<GroupGrantsListResponseDto> {
        await this.assertGroupExists(groupId);

        const page = Math.max(1, query.page ?? 1);
        const page_size = Math.min(
            CourseAccessService.MAX_PAGE_SIZE,
            Math.max(1, query.page_size ?? CourseAccessService.DEFAULT_PAGE_SIZE),
        );
        const only_active = query.only_active ?? true;

        const where: any = {
            group_id: groupId,
            webinar_id: { not: null },
        };
        if (only_active) {
            where.refund_at = null;
            where.access_to_purchased_item = true;
        }

        const [total, rows] = await this.prisma.$transaction([
            this.prisma.sale.count({ where }),
            this.prisma.sale.findMany({
                where,
                select: {
                    id: true,
                    webinar_id: true,
                    created_at: true,
                    refund_at: true,
                    access_days: true,
                    seller_id: true,
                    seller: { select: { id: true, full_name: true } },
                    webinar: {
                        select: {
                            id: true,
                            slug: true,
                            translations: { where: { locale: 'kz' }, select: { title: true }, take: 1 },
                        },
                    },
                },
                orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
                take: page_size,
                skip: (page - 1) * page_size,
            }),
        ]);

        const now = Math.floor(Date.now() / 1000);
        const out: CourseGrantRowDto[] = rows.map((r: any) => {
            const expiresAt = r.access_days === null ? null : Number(r.created_at) + r.access_days * 86400;
            const isExpired = expiresAt !== null && expiresAt < now;
            const isActive = r.refund_at === null && !isExpired;
            const daysRemaining = expiresAt === null ? null : Math.max(0, Math.floor((expiresAt - now) / 86400));
            return {
                sale_id: Number(r.id),
                course: {
                    id: Number(r.webinar?.id ?? r.webinar_id ?? 0),
                    title: r.webinar?.translations?.[0]?.title ?? r.webinar?.slug ?? '—',
                    slug: r.webinar?.slug ?? '—',
                },
                granted_at: Number(r.created_at),
                expires_at: expiresAt,
                days_remaining: daysRemaining,
                is_active: isActive,
                granted_by: r.seller ? { id: Number(r.seller.id), full_name: r.seller.full_name ?? null } : null,
                refund_at: r.refund_at ?? null,
            };
        });

        return { rows: out, total, page, page_size };
    }

    // -----------------------------------------------------------------------
    // listCourseAccessors / summary — Feature C (Course → Accessors tab)
    // -----------------------------------------------------------------------

    /**
     * UNION of direct (per-user) accessors and via-group accessors for one course.
     *
     * Strategy:
     *   1. Fetch active direct sales for this course (buyer_id IS NOT NULL).
     *   2. Fetch active group sales for this course (group_id IS NOT NULL),
     *      eager-load each group's current members (GroupUser rows).
     *   3. Expand groups → members; merge with direct.
     *   4. On dedup: direct wins (it survives the user leaving the group).
     *   5. Compute last_course_activity in batch across CourseLearning ∪
     *      QuizResult ∪ WebinarAssignmentHistory.
     *   6. Apply filters (q / group_id / source), sort, paginate in JS.
     *
     * Admin-data scale assumption: total accessor count per course expected
     * < 5000. If a single group exceeds 50k members, refactor to SQL UNION
     * with cursor pagination. For now JS materialisation is a deliberate
     * trade-off for clarity + reuse of the dedup/last-activity logic.
     */
    public async listCourseAccessors(
        courseId: number,
        query: ListCourseAccessorsQueryDto,
    ): Promise<CourseAccessorsListResponseDto> {
        await this.assertCourseExists(courseId);

        const page = Math.max(1, query.page ?? 1);
        const page_size = Math.min(
            CourseAccessService.MAX_PAGE_SIZE,
            Math.max(1, query.page_size ?? CourseAccessService.DEFAULT_PAGE_SIZE),
        );

        const allRows = await this.buildAccessorRows(courseId);
        const filtered = this.applyAccessorFilters(allRows, query);
        const sorted = this.sortAccessors(filtered, query.sort ?? 'granted_at', query.order ?? 'desc');

        const total = sorted.length;
        const start = (page - 1) * page_size;
        const slice = sorted.slice(start, start + page_size);

        return { rows: slice, total, page, page_size };
    }

    public async courseAccessorsSummary(courseId: number): Promise<CourseAccessorsSummaryDto> {
        await this.assertCourseExists(courseId);
        const allRows = await this.buildAccessorRows(courseId);
        const nowSec = Math.floor(Date.now() / 1000);
        const sevenDaysAgo = nowSec - 7 * 86400;

        let direct_count = 0;
        let via_group_count = 0;
        let active_last_7d = 0;
        for (const r of allRows) {
            if (r.source.kind === 'direct') direct_count += 1;
            else via_group_count += 1;
            if (r.last_course_activity !== null && r.last_course_activity >= sevenDaysAgo) {
                active_last_7d += 1;
            }
        }

        const groups_count = new Set(
            allRows
                .filter((r) => r.source.kind === 'group' && r.source.group_id !== null)
                .map((r) => r.source.group_id as number),
        ).size;

        return {
            total: allRows.length,
            direct_count,
            via_group_count,
            groups_count,
            active_last_7d,
        };
    }

    /**
     * Build the merged accessor list — used by both list() and summary().
     * Returns one row per user, with `last_course_activity` populated.
     */
    private async buildAccessorRows(courseId: number): Promise<CourseAccessorRowDto[]> {
        // 1+2. Direct + group sales for this course (active only).
        const [directSales, groupSales] = await this.prisma.$transaction([
            this.prisma.sale.findMany({
                where: {
                    webinar_id: courseId,
                    buyer_id: { not: null },
                    refund_at: null,
                    access_to_purchased_item: true,
                },
                select: {
                    id: true,
                    buyer_id: true,
                    created_at: true,
                    access_days: true,
                    buyer: { select: { id: true, full_name: true, email: true, mobile: true } },
                },
            }),
            this.prisma.sale.findMany({
                where: {
                    webinar_id: courseId,
                    group_id: { not: null },
                    refund_at: null,
                    access_to_purchased_item: true,
                },
                select: {
                    id: true,
                    group_id: true,
                    created_at: true,
                    access_days: true,
                    group: {
                        select: {
                            id: true,
                            name: true,
                            members: {
                                select: {
                                    user: { select: { id: true, full_name: true, email: true, mobile: true } },
                                },
                            },
                        },
                    },
                },
            }),
        ]);

        const nowSec = Math.floor(Date.now() / 1000);
        const byUser = new Map<number, CourseAccessorRowDto>();

        // 3. Materialize direct rows first — they win dedup.
        for (const s of directSales) {
            if (!s.buyer || s.buyer_id === null) continue;
            byUser.set(s.buyer.id, {
                user: {
                    id: s.buyer.id,
                    full_name: s.buyer.full_name ?? null,
                    email: s.buyer.email ?? null,
                    mobile: s.buyer.mobile ?? null,
                },
                source: { kind: 'direct', group_id: null, group_name: null },
                sale_id: Number(s.id),
                granted_at: Number(s.created_at),
                expires_at: s.access_days === null ? null : Number(s.created_at) + s.access_days * 86400,
                days_remaining: s.access_days === null ? null : daysRemaining(Number(s.created_at), s.access_days, nowSec),
                last_course_activity: null,
                is_active: this.isSaleActive(Number(s.created_at), s.access_days, nowSec),
                progress: { done: 0, total: 0, percent: 0 },
            });
        }

        // 4. Expand group sales → members; skip users already covered by direct.
        for (const gs of groupSales) {
            if (!gs.group || gs.group_id === null) continue;
            const expiresAt = gs.access_days === null ? null : Number(gs.created_at) + gs.access_days * 86400;
            const groupName = gs.group.name;
            for (const m of gs.group.members) {
                if (!m.user) continue;
                if (byUser.has(m.user.id)) continue;
                byUser.set(m.user.id, {
                    user: {
                        id: m.user.id,
                        full_name: m.user.full_name ?? null,
                        email: m.user.email ?? null,
                        mobile: m.user.mobile ?? null,
                    },
                    source: { kind: 'group', group_id: gs.group.id, group_name: groupName },
                    sale_id: Number(gs.id),
                    granted_at: Number(gs.created_at),
                    expires_at: expiresAt,
                    days_remaining:
                        gs.access_days === null
                            ? null
                            : daysRemaining(Number(gs.created_at), gs.access_days, nowSec),
                    last_course_activity: null,
                    is_active: this.isSaleActive(Number(gs.created_at), gs.access_days, nowSec),
                    progress: { done: 0, total: 0, percent: 0 },
                });
            }
        }

        // 5. Batch last_course_activity across 3 progress tables, then aggregate
        // per-user progress on REQUIRED course items. Two batched query bundles —
        // bounded by accessor count (typically < 5000 per course).
        const userIds = Array.from(byUser.keys());
        if (userIds.length > 0) {
            const [activity, progress] = await Promise.all([
                this.fetchLastCourseActivity(courseId, userIds),
                this.progressService.batchUserAggregates(courseId, userIds),
            ]);
            for (const [uid, ts] of activity) {
                const row = byUser.get(uid);
                if (row) row.last_course_activity = ts;
            }
            for (const [uid, agg] of progress) {
                const row = byUser.get(uid);
                if (row) row.progress = agg;
            }
        }

        return Array.from(byUser.values());
    }

    /**
     * MAX(created_at) across course_learning (via file.webinar_id), quiz_results
     * (webinar_id direct), webinar_assignment_history (via assignment.webinar_id).
     *
     * Returns Map<userId, latest_unix_seconds>. Users with no activity are absent.
     *
     * Two preliminary lookups (course's file IDs + assignment IDs) avoid Prisma
     * groupBy's lack of nested-relation `where`. The lookups hit pre-existing
     * indexes (files.webinar_id, webinar_assignments.webinar_id) and return at
     * most a few dozen IDs each.
     */
    private async fetchLastCourseActivity(
        courseId: number,
        userIds: number[],
    ): Promise<Map<number, number>> {
        const [courseFileIds, courseAssignmentIds] = await Promise.all([
            this.prisma.files.findMany({
                where: { webinar_id: courseId },
                select: { id: true },
            }),
            this.prisma.webinarAssignment.findMany({
                where: { webinar_id: courseId },
                select: { id: true },
            }),
        ]);

        const fileIds = courseFileIds.map((f) => f.id);
        const assignmentIds = courseAssignmentIds.map((a) => a.id);

        const [learningGroups, quizGroups, assignmentGroups] = await Promise.all([
            fileIds.length > 0
                ? this.prisma.courseLearning.groupBy({
                      by: ['user_id'],
                      where: { user_id: { in: userIds }, file_id: { in: fileIds } },
                      _max: { created_at: true },
                      orderBy: { user_id: 'asc' },
                  })
                : Promise.resolve([] as Array<{ user_id: number; _max: { created_at: number | null } }>),
            this.prisma.quizResult.groupBy({
                by: ['user_id'],
                where: { user_id: { in: userIds }, webinar_id: courseId },
                _max: { created_at: true },
                orderBy: { user_id: 'asc' },
            }),
            assignmentIds.length > 0
                ? this.prisma.webinarAssignmentHistory.groupBy({
                      by: ['student_id'],
                      where: { student_id: { in: userIds }, assignment_id: { in: assignmentIds } },
                      _max: { created_at: true },
                      orderBy: { student_id: 'asc' },
                  })
                : Promise.resolve(
                      [] as Array<{ student_id: number; _max: { created_at: bigint | null } }>,
                  ),
        ]);

        const out = new Map<number, number>();
        const bump = (uid: number, ts: number | null) => {
            if (ts === null) return;
            const cur = out.get(uid) ?? 0;
            if (ts > cur) out.set(uid, ts);
        };
        for (const g of learningGroups) bump(g.user_id, g._max.created_at ?? null);
        for (const g of quizGroups) bump(g.user_id, g._max.created_at ?? null);
        for (const g of assignmentGroups) {
            const ts = g._max.created_at;
            bump(g.student_id, ts === null || ts === undefined ? null : Number(ts));
        }
        return out;
    }

    private applyAccessorFilters(
        rows: CourseAccessorRowDto[],
        query: ListCourseAccessorsQueryDto,
    ): CourseAccessorRowDto[] {
        let out = rows;

        if (query.source) {
            out = out.filter((r) => r.source.kind === query.source);
        }
        if (typeof query.group_id === 'number') {
            const gid = query.group_id;
            out = out.filter((r) => r.source.kind === 'group' && r.source.group_id === gid);
        }
        if (query.q && query.q.trim().length > 0) {
            const raw = query.q.trim().toLowerCase();
            const phoneNorm = normalizeKzPhone(raw);
            out = out.filter((r) => {
                const name = (r.user.full_name ?? '').toLowerCase();
                const email = (r.user.email ?? '').toLowerCase();
                const mobile = (r.user.mobile ?? '').toLowerCase();
                if (name.includes(raw) || email.includes(raw)) return true;
                if (phoneNorm && mobile.includes(phoneNorm)) return true;
                if (mobile.includes(raw)) return true;
                return false;
            });
        }
        return out;
    }

    private sortAccessors(
        rows: CourseAccessorRowDto[],
        sort: 'granted_at' | 'expires_at' | 'last_activity' | 'full_name',
        order: 'asc' | 'desc',
    ): CourseAccessorRowDto[] {
        const sign = order === 'asc' ? 1 : -1;
        const out = rows.slice();
        out.sort((a, b) => {
            switch (sort) {
                case 'full_name': {
                    const ax = (a.user.full_name ?? '').toLowerCase();
                    const bx = (b.user.full_name ?? '').toLowerCase();
                    return ax.localeCompare(bx) * sign;
                }
                case 'expires_at': {
                    // null (perpetual) sorts as "best" in desc → use +Infinity
                    const ax = a.expires_at ?? Number.POSITIVE_INFINITY;
                    const bx = b.expires_at ?? Number.POSITIVE_INFINITY;
                    return (ax - bx) * sign;
                }
                case 'last_activity': {
                    const ax = a.last_course_activity ?? 0;
                    const bx = b.last_course_activity ?? 0;
                    return (ax - bx) * sign;
                }
                case 'granted_at':
                default:
                    return (a.granted_at - b.granted_at) * sign;
            }
        });
        return out;
    }

    private isSaleActive(createdAt: number, accessDays: number | null, nowSec: number): boolean {
        if (accessDays === null) return true;
        const expiry = createdAt + accessDays * 86400;
        return nowSec <= expiry;
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    /**
     * Convert an absolute expiry (Unix sec) to relative `access_days` from `from`.
     * Null `expiresAt` → perpetual (null).
     * `expiresAt <= from` → 400.
     */
    private toAccessDays(from: number, expiresAt: number | null | undefined): number | null {
        if (expiresAt === null || expiresAt === undefined) return null;
        const delta = expiresAt - from;
        if (delta <= 0) {
            throw new BadRequestException('course_access.expires_in_past');
        }
        return Math.ceil(delta / 86400);
    }

    private async assertUserExists(userId: number): Promise<void> {
        const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
        if (!u) throw new NotFoundException('course_access.user_not_found');
    }

    private async assertGroupExists(groupId: number): Promise<void> {
        const g = await this.prisma.group.findUnique({ where: { id: groupId }, select: { id: true } });
        if (!g) throw new NotFoundException('course_access.group_not_found');
    }

    private async assertCourseExists(courseId: number): Promise<void> {
        const c = await this.prisma.webinar.findUnique({
            where: { id: courseId },
            select: { id: true, deleted_at: true },
        });
        if (!c || c.deleted_at !== null) {
            throw new NotFoundException('course_access.course_not_found');
        }
    }
}
