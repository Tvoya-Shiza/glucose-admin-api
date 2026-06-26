import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { ScheduleDto, ScheduleListQueryDto } from './dto/schedule.dto';
import { CoursesCacheService } from './utils/courses-cache.service';
import { COURSES_INVALIDATE_PATTERN } from './utils/course-cache';

/**
 * CRS-08 — per-stream content scheduling service (Plan 06).
 *
 * Endpoints (controller):
 *   GET    /admin-api/v1/admin/courses/:id/schedules            (?group_id=)
 *   POST   /admin-api/v1/admin/courses/:id/schedules
 *   PATCH  /admin-api/v1/admin/courses/:id/schedules/:scheduleId
 *   DELETE /admin-api/v1/admin/courses/:id/schedules/:scheduleId
 *
 * SCHEMA-TRUTH (locked Plan 01, applied here):
 *
 *   - WebinarChapterSchedule.id is `BigInt @db.UnsignedBigInt` (schema line 1146).
 *     Path params are accepted as STRING and parsed to BigInt at the service
 *     boundary. Responses serialize BigInt as STRING via the global
 *     BigIntStringInterceptor — the service returns rows containing real BigInts;
 *     the interceptor handles the wire format.
 *
 *   - WebinarChapterSchedule does NOT have webinar_id / chapter_id columns.
 *     The schedule links via webinar_chapter_item_id only (schema line 1149).
 *     This service derives course/chapter scope by joining
 *     WebinarChapterItem → WebinarChapter (relation: webinar_chapter) → Webinar
 *     (relation: webinar_id).
 *
 *   - WebinarChapterSchedule.teacher_id is NOT NULL (schema line 1147). We fill
 *     it from the joined Webinar.teacher_id at the time of CREATE — NOT from the
 *     request body. This is intentional: the schedule's teacher is informational
 *     only and follows the course's teacher; user-supplied teacher_id would be a
 *     tampering vector. When a course's teacher changes (Plan 07), existing
 *     schedules' teacher_id is NOT auto-updated — accepted gap, future polish.
 *
 *   - Conflict key: (group_id, webinar_chapter_item_id). Schema has NO @@unique
 *     constraint, so we enforce uniqueness in service code via find-then-create
 *     (409 ConflictException on duplicate). T-05-60: race window between findFirst
 *     and create is documented as accepted (impact: operator sees two duplicate
 *     rows and deletes one — recoverable). A future schema-pass may add the
 *     @@unique to harden this in the DB layer.
 *
 *   - end_date >= start_date is enforced by the DTO's class-level @ValidateIf.
 *     Service does not re-check.
 *
 * SCOPE GATE (3-step assert):
 *   1. Existence: prisma.webinar.findFirst({ id, deleted_at: null }) -> 404 on null.
 *   2. Teacher gate: teacher narrowed to own course (teacher_id === actor.id) -> else 403.
 *   3. Proceed.
 *
 * admin, curator and any other admitted role pass the teacher gate — access is governed
 * by @RequirePermission on the controller (no blanket role denial; only teacher narrows).
 *
 * AUDIT: 3 audited handlers in the controller (create / update / delete). GET is
 * audit-exempt per project policy.
 *
 * CACHE INVALIDATION: COURSES_INVALIDATE_PATTERN on every mutation (CONTEXT D-25 —
 * aggressive invalidation; the schedule_count derivation in CoursesDetailService
 * picks up the new count on the next read).
 */
@Injectable()
export class CoursesScheduleService {
    private readonly logger = new Logger(CoursesScheduleService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly cache: CoursesCacheService,
    ) {}

    // ---------------------------------------------------------------------
    // Scope gate (3-step)
    // ---------------------------------------------------------------------

    private async assertCourseScope(
        actor: ScopeActor,
        courseId: number,
    ): Promise<{ id: number; teacher_id: number }> {
        const existing: any = await this.prisma.webinar.findFirst({
            where: { id: courseId, deleted_at: null },
            select: { id: true, teacher_id: true },
        });
        if (!existing) {
            throw new NotFoundException('courses.not_found');
        }
        // Teacher is narrowed to own course (per-tenant ownership); admin, curator and any
        // other admitted role pass — governed by @RequirePermission on the controller.
        if (actor.role_name === 'teacher' && Number(existing.teacher_id) !== actor.id) {
            throw new ForbiddenException('courses.forbidden_scope');
        }
        return { id: Number(existing.id), teacher_id: Number(existing.teacher_id) };
    }

    // ---------------------------------------------------------------------
    // Row select shape — keeps create/update/list responses in one place
    // ---------------------------------------------------------------------

    private readonly SCHEDULE_SELECT = {
        id: true,
        teacher_id: true,
        group_id: true,
        webinar_chapter_item_id: true,
        start_date: true,
        end_date: true,
        is_before_start: true,
        expiration_check: true,
        created_at: true,
        updated_at: true,
        webinar_chapter_item: {
            select: {
                id: true,
                type: true,
                item_id: true,
                order: true,
                webinar_chapter: {
                    select: {
                        id: true,
                        order: true,
                        translations: { select: { locale: true, title: true } },
                    },
                },
            },
        },
    } as const;

    private toRow(row: any): any {
        const chapter = row.webinar_chapter_item?.webinar_chapter;
        return {
            id: row.id, // BigInt — interceptor → string
            teacher_id: Number(row.teacher_id),
            group_id: Number(row.group_id),
            webinar_chapter_item_id: Number(row.webinar_chapter_item_id),
            start_date: Number(row.start_date),
            end_date: Number(row.end_date),
            is_before_start: !!row.is_before_start,
            expiration_check: !!row.expiration_check,
            created_at: row.created_at, // DateTime — serialized as ISO string by Nest
            updated_at: row.updated_at,
            item: row.webinar_chapter_item
                ? {
                      id: Number(row.webinar_chapter_item.id),
                      type: row.webinar_chapter_item.type as 'file' | 'quiz' | 'assignment',
                      item_id: Number(row.webinar_chapter_item.item_id),
                      order:
                          row.webinar_chapter_item.order == null
                              ? null
                              : Number(row.webinar_chapter_item.order),
                  }
                : null,
            chapter: chapter
                ? {
                      id: Number(chapter.id),
                      order: chapter.order == null ? null : Number(chapter.order),
                      translations: (chapter.translations ?? [])
                          .filter((t: any) => t.locale === 'kz')
                          .map((t: any) => ({ locale: t.locale, title: t.title })),
                  }
                : null,
        };
    }

    // ---------------------------------------------------------------------
    // List
    // ---------------------------------------------------------------------

    public async list(
        actor: ScopeActor,
        courseId: number,
        query: ScheduleListQueryDto,
    ): Promise<{ rows: any[] }> {
        await this.assertCourseScope(actor, courseId);

        const rows: any[] = await this.prisma.webinarChapterSchedule.findMany({
            where: {
                webinar_chapter_item: { webinar_chapter: { webinar_id: courseId } },
                ...(typeof query.group_id === 'number' ? { group_id: query.group_id } : {}),
            },
            select: this.SCHEDULE_SELECT,
            orderBy: [{ webinar_chapter_item_id: 'asc' }, { start_date: 'asc' }],
        });

        return { rows: rows.map((r) => this.toRow(r)) };
    }

    // ---------------------------------------------------------------------
    // Create
    // ---------------------------------------------------------------------

    public async create(actor: ScopeActor, courseId: number, dto: ScheduleDto): Promise<any> {
        const course = await this.assertCourseScope(actor, courseId);

        // Validate item belongs to this course (T-05-61).
        const item: any = await this.prisma.webinarChapterItem.findFirst({
            where: {
                id: dto.webinar_chapter_item_id,
                webinar_chapter: { webinar_id: courseId },
            },
            select: { id: true },
        });
        if (!item) {
            throw new BadRequestException('schedule.item_not_in_course');
        }

        // Validate group exists (T-05-62).
        const group: any = await this.prisma.group.findFirst({
            where: { id: dto.group_id },
            select: { id: true },
        });
        if (!group) {
            throw new BadRequestException('schedule.group_not_found');
        }

        // Conflict check on (group_id, webinar_chapter_item_id) — schema lacks
        // @@unique, so enforce in code (T-05-60).
        const conflict: any = await this.prisma.webinarChapterSchedule.findFirst({
            where: {
                group_id: dto.group_id,
                webinar_chapter_item_id: dto.webinar_chapter_item_id,
            },
            select: { id: true },
        });
        if (conflict) {
            throw new ConflictException('schedule.conflict');
        }

        const created: any = await this.prisma.webinarChapterSchedule.create({
            data: {
                teacher_id: course.teacher_id, // NOT NULL — derived from joined Webinar.teacher_id
                group_id: dto.group_id,
                webinar_chapter_item_id: dto.webinar_chapter_item_id,
                start_date: dto.start_date,
                end_date: dto.end_date,
                is_before_start: dto.is_before_start,
                expiration_check: dto.expiration_check,
            },
            select: this.SCHEDULE_SELECT,
        });

        await this.cache.invalidate(COURSES_INVALIDATE_PATTERN);
        return this.toRow(created);
    }

    // ---------------------------------------------------------------------
    // Update
    // ---------------------------------------------------------------------

    public async update(
        actor: ScopeActor,
        courseId: number,
        scheduleId: bigint,
        dto: ScheduleDto,
    ): Promise<any> {
        await this.assertCourseScope(actor, courseId);

        // Verify the schedule belongs to a course-owned item.
        const existing: any = await this.prisma.webinarChapterSchedule.findFirst({
            where: {
                id: scheduleId,
                webinar_chapter_item: { webinar_chapter: { webinar_id: courseId } },
            },
            select: { id: true, group_id: true, webinar_chapter_item_id: true },
        });
        if (!existing) {
            throw new NotFoundException('schedule.not_found');
        }

        const newGroupId = dto.group_id;
        const newItemId = dto.webinar_chapter_item_id;

        // If group_id or webinar_chapter_item_id is changing, re-check item ownership and conflict.
        if (
            newGroupId !== Number(existing.group_id) ||
            newItemId !== Number(existing.webinar_chapter_item_id)
        ) {
            // New item must still belong to this course (T-05-61).
            const item: any = await this.prisma.webinarChapterItem.findFirst({
                where: {
                    id: newItemId,
                    webinar_chapter: { webinar_id: courseId },
                },
                select: { id: true },
            });
            if (!item) {
                throw new BadRequestException('schedule.item_not_in_course');
            }

            // Conflict check excluding this row (T-05-60).
            const conflict: any = await this.prisma.webinarChapterSchedule.findFirst({
                where: {
                    group_id: newGroupId,
                    webinar_chapter_item_id: newItemId,
                    NOT: { id: scheduleId },
                },
                select: { id: true },
            });
            if (conflict) {
                throw new ConflictException('schedule.conflict');
            }

            // Validate group exists (T-05-62).
            const group: any = await this.prisma.group.findFirst({
                where: { id: newGroupId },
                select: { id: true },
            });
            if (!group) {
                throw new BadRequestException('schedule.group_not_found');
            }
        }

        const updated: any = await this.prisma.webinarChapterSchedule.update({
            where: { id: scheduleId },
            data: {
                group_id: newGroupId,
                webinar_chapter_item_id: newItemId,
                start_date: dto.start_date,
                end_date: dto.end_date,
                is_before_start: dto.is_before_start,
                expiration_check: dto.expiration_check,
            },
            select: this.SCHEDULE_SELECT,
        });

        await this.cache.invalidate(COURSES_INVALIDATE_PATTERN);
        return this.toRow(updated);
    }

    // ---------------------------------------------------------------------
    // Delete
    // ---------------------------------------------------------------------

    public async delete(
        actor: ScopeActor,
        courseId: number,
        scheduleId: bigint,
    ): Promise<{ id: string; deleted: true }> {
        await this.assertCourseScope(actor, courseId);

        const existing: any = await this.prisma.webinarChapterSchedule.findFirst({
            where: {
                id: scheduleId,
                webinar_chapter_item: { webinar_chapter: { webinar_id: courseId } },
            },
            select: { id: true },
        });
        if (!existing) {
            throw new NotFoundException('schedule.not_found');
        }

        await this.prisma.webinarChapterSchedule.delete({ where: { id: scheduleId } });
        await this.cache.invalidate(COURSES_INVALIDATE_PATTERN);

        return { id: scheduleId.toString(), deleted: true };
    }
}
