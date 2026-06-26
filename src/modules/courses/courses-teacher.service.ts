import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { ChangeTeacherDto } from './dto/change-teacher.dto';
import { CoursesDetailService } from './courses-detail.service';
import { CoursesCacheService } from './utils/courses-cache.service';
import {
    COURSES_DETAIL_INVALIDATE_PATTERN,
    COURSES_LIST_INVALIDATE_PATTERN,
} from './utils/course-cache';
import type { CourseDetailDto } from './dto/course-detail.dto';

/**
 * CRS-06 — course-teacher reassignment service (Plan 07).
 *
 * PATCH /admin-api/v1/admin/courses/:id/teacher
 *
 * Behavior (mirrors Phase 4 Plan 03 GroupsSupervisorService verbatim):
 *   - Access is governed by @Roles + a grantable @RequirePermission('courses.edit') on
 *     the controller — no blanket role denial in the service.
 *   - Validates target user exists, NOT soft-deleted, AND has role_name='teacher'.
 *     Mismatch -> NotFoundException('courses.teacher_not_found'). Preserves invariant:
 *     Webinar.teacher_id always references a non-deleted teacher (T-05-71 mitigation).
 *   - Idempotency: dto.teacher_id === current.teacher_id short-circuits to a re-read of
 *     the detail with previous_teacher_id mirrored from the current teacher_id. No write,
 *     no audit-meaningful diff.
 *   - Atomic update via prisma.$transaction([...]) — single-op tx so future cascades
 *     (e.g. propagating teacher_id to existing WebinarChapterSchedule rows, or notification
 *     fan-out) can be appended without restructuring the call site.
 *   - updated_at set to Math.floor(Date.now() / 1000) — Webinar.updated_at is Int (Unix
 *     seconds) per schema, NOT DateTime.
 *
 * AUDIT METADATA TRICK (Phase 4 Plan 03 reuse — `previous_supervisor_id` -> `previous_teacher_id`):
 *   The response shape includes `previous_teacher_id` so AuditInterceptor records the
 *   before-state via response shape. Cheapest before+after capture without touching
 *   AdminAuditLog snapshot semantics. The admin-client MUST strip this audit-only field
 *   before caching the response as a CourseDetail (see TeacherChangeDialog onSuccess).
 *
 * CACHE INVALIDATION: Both list + detail patterns invalidated on success — the new
 * teacher's view should pick up the course on next list-read; the old teacher's view
 * should drop it. Detail cache is per-actor-scoped (CoursesDetailService cache key
 * carries `:scope:<role>:<id>`), so a blanket `geonline-admin:courses:detail:*` SCAN
 * is correct.
 */
@Injectable()
export class CoursesTeacherService {
    private readonly logger = new Logger(CoursesTeacherService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly detail: CoursesDetailService,
        private readonly cache: CoursesCacheService,
    ) {}

    public async changeTeacher(
        actor: ScopeActor,
        courseId: number,
        dto: ChangeTeacherDto,
    ): Promise<CourseDetailDto & { previous_teacher_id: number | null }> {
        // Access is governed by @Roles + a grantable @RequirePermission on the controller —
        // no blanket role denial here.

        // Existence check — soft-deleted (deleted_at != null) counts as absent.
        const course: any = await this.prisma.webinar.findFirst({
            where: { id: courseId, deleted_at: null },
            select: { id: true, teacher_id: true },
        });
        if (!course) {
            throw new NotFoundException('courses.not_found');
        }

        const previous_teacher_id =
            course.teacher_id != null ? Number(course.teacher_id) : null;

        // Validate target staff (role_name='teacher', not soft-deleted).
        // Preserves invariant: Webinar.teacher_id always references a non-deleted teacher
        // (T-05-71 mitigation: prevents promoting role='admin'/'student' to course author
        // via this endpoint).
        const target: any = await this.prisma.user.findFirst({
            where: { id: dto.teacher_id, deleted_at: null, role_name: 'teacher' },
            select: { id: true },
        });
        if (!target) {
            throw new NotFoundException('courses.teacher_not_found');
        }

        // Idempotency: same teacher_id -> return current detail w/ previous_teacher_id = current.
        // No write; no audit-meaningful diff. Audit row is still emitted (controller's @Audit fires
        // on successful response) — meta will carry previous_teacher_id === new teacher_id.
        if (Number(course.teacher_id) === dto.teacher_id) {
            const detail = await this.detail.getDetail(actor, courseId);
            return { ...detail, previous_teacher_id };
        }

        // Atomic update — single-op tx (consistency with Phase 4 Plan 03 supervisor-change shape).
        await this.prisma.$transaction([
            this.prisma.webinar.update({
                where: { id: courseId },
                data: {
                    teacher_id: dto.teacher_id,
                    updated_at: Math.floor(Date.now() / 1000),
                },
            }),
        ]);

        // Invalidate caches BEFORE re-reading the detail so the cached read-through
        // doesn't return the pre-change shape.
        await this.cache.invalidate(COURSES_DETAIL_INVALIDATE_PATTERN);
        await this.cache.invalidate(COURSES_LIST_INVALIDATE_PATTERN);

        const detail = await this.detail.getDetail(actor, courseId);
        // previous_teacher_id surfaced for AuditInterceptor NDJSON meta.
        // Admin-client TeacherChangeDialog strips this field before setQueryData.
        return { ...detail, previous_teacher_id };
    }
}
