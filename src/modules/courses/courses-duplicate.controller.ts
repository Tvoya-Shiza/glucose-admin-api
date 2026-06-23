import { Controller, HttpCode, HttpStatus, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { Audit } from '../../common/audit/audit.decorator';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { CoursesDuplicateService } from './courses-duplicate.service';

/**
 * CRS-DUP — POST /admin-api/v1/admin/courses/:id/duplicate.
 *
 * Own controller (not folded into mutations) per the courses module's one-controller-
 * per-concern convention; mirrors QuizzesDuplicateController. Keeps @Audit coverage
 * trivially auditable.
 *
 * RBAC: admin / teacher (own course). Curator is listed at @Roles for surface
 * uniformity but the service layer hard-denies curator (403). Reuses the existing
 * `courses.create` permission code (no new permission to seed/sync), matching how the
 * quiz duplicate reuses `quizzes.create`.
 *
 * Audit: @Audit('courses.duplicate', 'webinar') — entity_id resolves from
 * `response.data.id` (the new course); duplicate stats (chapters_copied, items_copied,
 * files_copied, assignments_copied, orphan_refs) ride the response body.
 */
@Controller('admin-api/v1/admin/courses')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class CoursesDuplicateController {
    constructor(private readonly svc: CoursesDuplicateService) {}

    @Post(':id/duplicate')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('courses.create')
    @Audit('courses.duplicate', 'webinar')
    @HttpCode(HttpStatus.OK)
    public async duplicate(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
    ) {
        return this.svc.duplicate({ id: actor.id, role_name: actor.role_name }, id);
    }
}
