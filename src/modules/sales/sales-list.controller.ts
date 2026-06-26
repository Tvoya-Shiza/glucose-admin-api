import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { ListSalesDto } from './dto/list-sales.dto';
import { SalesListService } from './sales-list.service';

/**
 * PAY-02 — GET /admin-api/v1/admin/sales.
 *
 * Returns the raw `SaleListResponseDto` shape (NOT wrapped in apiResponse) per
 * glucose-admin-api/CLAUDE.md "List endpoints (Phase 3+) return `{ rows, total, ... }`
 * directly — TanStack Table on the admin-client consumes the raw shape." Our shape
 * is `{ rows, total, page, page_size, next_cursor }` per Plan 01's locked
 * lib/sales/types.ts contract.
 *
 * RBAC (D-18, D-20): runtime-driven via @RequirePermission('sales.view'). Any
 * admitted role (admin/curator/teacher) holding the grant sees all rows; roles
 * without the grant are rejected by PermissionGuard.
 *
 * Audit posture: GET endpoints exempt from the @Audit lint (only POST/PUT/PATCH/DELETE
 * trip the requirement) — no decorator needed here.
 */
@Controller('admin-api/v1/admin/sales')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class SalesListController {
    constructor(private readonly listService: SalesListService) {}

    @Get()
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('sales.view')
    public async list(@CurrentUser() actor: AuthenticatedRequestUser, @Query() query: ListSalesDto) {
        return this.listService.list({ id: actor.id, role_name: actor.role_name }, query);
    }
}
