import { Controller, Get, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { SalesDetailService } from './sales-detail.service';

/**
 * PAY-02 / D-06 — GET /admin-api/v1/admin/sales/:id.
 *
 * Returns the raw `SaleDetailDto` shape (NOT wrapped in apiResponse) — mirrors
 * the list endpoint shape so admin-client TanStack Query consumes a consistent
 * payload across list + detail (no envelope-strip needed for either).
 *
 * RBAC (D-18, D-20): admin-only — curator + teacher hit RolesGuard 403. Service
 * additionally throws ForbiddenException as belt-and-braces.
 *
 * Audit posture: GET exempt from @Audit lint (only mutations require it).
 */
@Controller('admin-api/v1/admin/sales')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class SalesDetailController {
    constructor(private readonly detailService: SalesDetailService) {}

    @Get(':id')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('sales.view')
    public async get(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
    ) {
        return this.detailService.get({ id: actor.id, role_name: actor.role_name }, id);
    }
}
