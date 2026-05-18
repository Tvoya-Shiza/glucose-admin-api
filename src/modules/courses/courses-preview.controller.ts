import { Controller, Get, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { PreviewQueryDto } from './dto/preview.dto';
import { CoursesPreviewService } from './courses-preview.service';

/**
 * CRS-09 — preview-as-student controller (Plan 07).
 *
 * Routes:
 *   GET /admin-api/v1/admin/courses/:id/preview?group_id=    -> read-only mirror render data
 *
 * RBAC: admin / teacher. Curator EXCLUDED at the @Roles surface (CONTEXT D-19 +
 * threat T-05-73): curators don't author courses and the preview endpoint reveals
 * full course content + per-group schedule windows; surfacing it to curators would
 * be a soft information-disclosure leak. Service-layer assertScope enforces 403 for
 * foreign-teacher (T-05-73).
 *
 * Audit: GET — exempt from @Audit lint by project policy. Per CONTEXT D-26 the rule
 * is "every MUTATION carries @Audit"; preview is read-only. Documented here so future
 * audit-lint hardening doesn't sweep this controller into a false-positive bucket.
 *
 * Read-only mirror posture (T-05-79 mitigation): NO impersonation. Admin's session
 * stays admin throughout. The PreviewRenderer in admin-client surfaces a banner so
 * the operator never confuses preview-mode for "I am the student now".
 */
@Controller('admin-api/v1/admin/courses/:id/preview')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
@Roles('admin', 'teacher')
export class CoursesPreviewController {
    constructor(private readonly svc: CoursesPreviewService) {}

    @Get()
    @RequirePermission('courses.view')
    public async getPreview(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
        @Query() query: PreviewQueryDto,
    ) {
        return this.svc.getPreview(
            { id: actor.id, role_name: actor.role_name },
            id,
            query.group_id,
        );
    }
}
