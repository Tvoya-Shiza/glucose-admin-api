import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { ListBannersDto } from './dto/list-banners.dto';
import { BannersListService } from './banners-list.service';

/**
 * BAN-01 — GET /admin-api/v1/admin/banners.
 *
 * Returns the raw `{ rows, total, pageCount }` shape (NOT wrapped) per CLAUDE.md.
 *
 * RBAC: runtime-driven. @Roles admits admin/curator/teacher; @RequirePermission('banners.view')
 * is the grantable gate. No ownership narrowing in BANNER_SCOPE_RULES.
 *
 * Audit: GET endpoints are exempt from the `ci:audit-required` lint.
 */
@Controller('admin-api/v1/admin/banners')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class BannersListController {
    constructor(private readonly svc: BannersListService) {}

    @Get()
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('banners.view')
    public async list(@CurrentUser() actor: AuthenticatedRequestUser, @Query() query: ListBannersDto) {
        return this.svc.list({ id: actor.id, role_name: actor.role_name }, query);
    }
}
