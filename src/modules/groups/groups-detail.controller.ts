import { Controller, Get, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { GroupsDetailService } from './groups-detail.service';

/**
 * GRP-05 + GRP-06 — GET /admin-api/v1/admin/groups/:id (Plan 03).
 *
 * RBAC: admin / curator / teacher hit the route; the service layer enforces the
 * 403-not-404 distinction:
 *   - admin           → 200 (sees all)
 *   - curator         → 200 if supervisor_id === actor.id else 403 (per-tenant narrowing)
 *   - teacher / other → 200 (governed by @RequirePermission grant; no per-tenant narrowing)
 *
 * 404 is reserved for "group genuinely does not exist" (existence check first, then
 * scope check). See GroupsDetailService header for the rationale (CONTEXT D-19).
 *
 * Audit posture: GET endpoints are exempt from the @Audit lint — no decorator needed.
 */
@Controller('admin-api/v1/admin/groups')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class GroupsDetailController {
    constructor(private readonly svc: GroupsDetailService) {}

    @Get(':id')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('groups.view')
    public async detail(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
    ) {
        return this.svc.detail({ id: actor.id, role_name: actor.role_name }, id);
    }
}
