import { Controller, Get, Query, UseGuards } from '@nestjs/common';
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
 * RBAC (D-20): admin-only. Curator/teacher get 403 from RolesGuard. Belt-and-braces
 * via BANNER_SCOPE_RULES (default-deny `id IN ()` if @Roles is somehow bypassed).
 *
 * Audit: GET endpoints are exempt from the `ci:audit-required` lint.
 */
@Controller('admin-api/v1/admin/banners')
@UseGuards(JwtGuard, RolesGuard)
export class BannersListController {
    constructor(private readonly svc: BannersListService) {}

    @Get()
    @Roles('admin')
    public async list(@CurrentUser() actor: AuthenticatedRequestUser, @Query() query: ListBannersDto) {
        return this.svc.list({ id: actor.id, role_name: actor.role_name }, query);
    }
}
