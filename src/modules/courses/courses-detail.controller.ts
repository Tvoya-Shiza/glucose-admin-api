import { Controller, Get, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { CoursesDetailService } from './courses-detail.service';

/**
 * CRS-01 + CRS-07 — GET /admin-api/v1/admin/courses/:id (Plan 03).
 *
 * RBAC: admin / curator / teacher hit the route; the service layer enforces the
 * 403-not-404 distinction (ROADMAP §"Phase 5" SC #4):
 *   - admin           → 200 (sees all)
 *   - teacher (own)   → 200
 *   - teacher (other) → 403 'courses.forbidden_scope'
 *   - curator         → 200 (governed by @RequirePermission('courses.view'); only teacher narrows)
 *
 * 404 is reserved for "course genuinely does not exist" (existence check first, then
 * scope check). See CoursesDetailService header for the rationale (mirrors Phase 4
 * Plan 03 GroupsDetailService divergence).
 *
 * Audit posture: GET endpoints are exempt from the @Audit lint — no decorator needed.
 */
@Controller('admin-api/v1/admin/courses')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class CoursesDetailController {
    constructor(private readonly svc: CoursesDetailService) {}

    @Get(':id')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('courses.view')
    public async getDetail(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
    ) {
        return this.svc.getDetail({ id: actor.id, role_name: actor.role_name }, id);
    }
}
