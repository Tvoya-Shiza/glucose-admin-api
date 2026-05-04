import {
    Body,
    Controller,
    Delete,
    HttpCode,
    HttpStatus,
    Param,
    ParseIntPipe,
    Patch,
    Post,
    UseGuards,
} from '@nestjs/common';
import { apiResponse } from '../../common/utils/api-response';
import { Audit } from '../../common/audit/audit.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { UpsertBannerDto } from './dto/upsert-banner.dto';
import { BannersMutationsService } from './banners-mutations.service';

/**
 * BAN-01 — admin-only banner mutations (Plan 03).
 *
 * Routes:
 *   POST   /admin-api/v1/admin/banners       -> create     (admin)
 *   PATCH  /admin-api/v1/admin/banners/:id   -> update     (admin)
 *   DELETE /admin-api/v1/admin/banners/:id   -> hard delete (admin)
 *
 * RBAC: admin-only. Curator/teacher excluded at @Roles + BANNER_SCOPE_RULES default-deny.
 *
 * Audit (D-17): every handler decorated with `@Audit('banners.<action>', 'advertisement')`.
 * Entity name follows the Prisma model (`advertisement`); product copy says "banner".
 * `ci:audit-required` enforces.
 */
@Controller('admin-api/v1/admin/banners')
@UseGuards(JwtGuard, RolesGuard)
export class BannersMutationsController {
    constructor(private readonly svc: BannersMutationsService) {}

    @Post()
    @Roles('admin')
    @Audit('banners.create', 'advertisement')
    public async create(@CurrentUser() actor: AuthenticatedRequestUser, @Body() dto: UpsertBannerDto) {
        const data = await this.svc.create({ id: actor.id, role_name: actor.role_name }, dto);
        return apiResponse(1, 'created', 'banners.created', data);
    }

    @Patch(':id')
    @Roles('admin')
    @Audit('banners.update', 'advertisement')
    public async update(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: UpsertBannerDto,
    ) {
        const data = await this.svc.update({ id: actor.id, role_name: actor.role_name }, id, dto);
        return apiResponse(1, 'ok', 'banners.updated', data);
    }

    @Delete(':id')
    @Roles('admin')
    @Audit('banners.delete', 'advertisement')
    @HttpCode(HttpStatus.OK)
    public async remove(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
    ) {
        const data = await this.svc.hardDelete({ id: actor.id, role_name: actor.role_name }, id);
        return apiResponse(1, 'ok', 'banners.deleted', data);
    }
}
