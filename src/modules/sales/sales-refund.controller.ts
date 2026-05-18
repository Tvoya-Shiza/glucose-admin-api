import { Body, Controller, HttpCode, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { Audit } from '../../common/audit/audit.decorator';
import { apiResponse } from '../../common/utils/api-response';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { RefundSaleDto } from './dto/refund-sale.dto';
import { SalesRefundService } from './sales-refund.service';

/**
 * PAY-03 — POST /admin-api/v1/admin/sales/:id/refund.
 *
 * Wraps the result with `apiResponse(...)` (mutation-style) per
 * glucose-admin-api/CLAUDE.md "Mutation/single-resource endpoints wrap with
 * apiResponse(...)". Differs from list/detail endpoints which return raw shape
 * for TanStack Table consumption — but mutations follow the apiResponse contract.
 *
 * RBAC (D-20, T-09-03-01): admin-only. Curator + teacher receive 403 from
 * RolesGuard. Service additionally throws ForbiddenException belt-and-braces.
 *
 * Audit (D-07, D-23, T-09-03-03): @Audit('sales.refund', 'sale') writes one
 * audit row per attempt (success OR failure — AuditInterceptor's catchError
 * branch records failed attempts too). Actor + ts + ip + ua are captured.
 * `entity_id` is read from the route param (`:id`) by AuditInterceptor's
 * `resolveEntityId` fallback.
 *
 * Idempotency: SalesRefundService throws ConflictException 409 when the Sale
 * is already refunded. NestJS's ExceptionFilter converts this to a JSON error
 * with status `409`; admin-client's refundSale wrapper catches `res.status === 409`
 * and surfaces a localized "already refunded" toast.
 */
@Controller('admin-api/v1/admin/sales')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class SalesRefundController {
    constructor(private readonly refundService: SalesRefundService) {}

    @Post(':id/refund')
    @HttpCode(200)
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('payments.refund')
    @Audit('sales.refund', 'sale')
    public async refund(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: RefundSaleDto,
    ) {
        const result = await this.refundService.refund(
            { id: actor.id, role_name: actor.role_name },
            id,
            dto.refund_reason,
        );
        return apiResponse(1, 'ok', 'sales.refund.success', result);
    }
}
