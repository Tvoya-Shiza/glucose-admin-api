import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { ListPromocodesDto } from './dto/list-promocodes.dto';
import { PromocodesListService } from './promocodes-list.service';

/**
 * PRM-01 — GET /admin-api/v1/admin/promocodes (Plan 05).
 *
 * Returns the raw `{ rows, total, pageCount }` shape (NOT wrapped) per CLAUDE.md.
 *
 * RBAC (D-20): admin-only. Curator/teacher get 403 from RolesGuard. Belt-and-braces
 * via PROMOCODE_SCOPE_RULES (default-deny `id IN ()` if @Roles is somehow bypassed).
 *
 * Audit: GET endpoints are exempt from the `ci:audit-required` lint.
 */
@Controller('admin-api/v1/admin/promocodes')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class PromocodesListController {
    constructor(private readonly svc: PromocodesListService) {}

    @Get()
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('promocodes.view')
    public async list(@CurrentUser() actor: AuthenticatedRequestUser, @Query() query: ListPromocodesDto) {
        return this.svc.list({ id: actor.id, role_name: actor.role_name }, query);
    }
}
