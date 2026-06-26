import { Body, Controller, Param, ParseIntPipe, Patch, UseGuards } from '@nestjs/common';
import { Audit } from '../../common/audit/audit.decorator';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { ChangeTeacherDto } from './dto/change-teacher.dto';
import { CoursesTeacherService } from './courses-teacher.service';

/**
 * CRS-06 — course-author reassignment (Plan 07).
 *
 * Routes:
 *   PATCH /admin-api/v1/admin/courses/:id/teacher    -> change teacher
 *
 * RBAC: @Roles('admin', 'curator', 'teacher') + a grantable @RequirePermission('courses.edit').
 * Access is governed at runtime by the permission grant — no blanket role denial in the
 * service layer.
 *
 * Audit: @Audit('courses.teacher.change', 'webinar') — AuditInterceptor records the
 * full response shape (which includes `previous_teacher_id` for before-state capture).
 *
 * teacher_id contract (per ChangeTeacherDto):
 *   - Required positive int — Webinar.teacher_id is NOT NULL on schema (no "clear assignment"
 *     sentinel like the GroupsSupervisor 0=clear case).
 *   - Service validates the user exists with role_name='teacher' and is NOT soft-deleted.
 */
@Controller('admin-api/v1/admin/courses')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class CoursesTeacherController {
    constructor(private readonly svc: CoursesTeacherService) {}

    @Patch(':id/teacher')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('courses.edit')
    @Audit('courses.teacher.change', 'webinar')
    public async changeTeacher(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: ChangeTeacherDto,
    ) {
        return this.svc.changeTeacher({ id: actor.id, role_name: actor.role_name }, id, dto);
    }
}
