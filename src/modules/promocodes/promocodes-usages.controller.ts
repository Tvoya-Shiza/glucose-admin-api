import { Controller, Get, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { ListUsagesDto } from './dto/list-usages.dto';
import { PromocodesUsagesService } from './promocodes-usages.service';

/**
 * PRM-02 — GET /admin-api/v1/admin/promocodes/:id/usages (Plan 05).
 *
 * Admin-only paginated list of PromocodeUsage rows joined to User (full_name +
 * email). Returns raw `{ rows, total, pageCount }` shape.
 *
 * Audit posture: GET endpoints are exempt from the `ci:audit-required` lint.
 */
@Controller('admin-api/v1/admin/promocodes')
@UseGuards(JwtGuard, RolesGuard)
export class PromocodesUsagesController {
    constructor(private readonly svc: PromocodesUsagesService) {}

    @Get(':id/usages')
    @Roles('admin')
    public async list(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
        @Query() query: ListUsagesDto,
    ) {
        return this.svc.list({ id: actor.id, role_name: actor.role_name }, id, query);
    }
}
