import { Controller, Get, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { PaymentsDetailService } from './payments-detail.service';

/**
 * PAY-01 / D-04 — GET /admin-api/v1/admin/payments/:id.
 *
 * Returns the raw `PaymentDetailDto` shape (NOT wrapped in apiResponse) — mirrors
 * the list endpoint shape so admin-client TanStack Query consumes a consistent
 * payload across list + detail (no envelope-strip needed for either).
 *
 * RBAC (D-18): admitted to admin/curator/teacher; access governed at runtime by
 * @RequirePermission('payments.view').
 *
 * Audit posture: GET exempt from @Audit lint (only mutations require it).
 */
@Controller('admin-api/v1/admin/payments')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class PaymentsDetailController {
    constructor(private readonly detailService: PaymentsDetailService) {}

    @Get(':id')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('payments.view')
    public async get(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
    ) {
        return this.detailService.get({ id: actor.id, role_name: actor.role_name }, id);
    }
}
