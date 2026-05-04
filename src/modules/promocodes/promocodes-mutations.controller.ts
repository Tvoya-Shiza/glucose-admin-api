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
import { UpsertPromocodeDto } from './dto/upsert-promocode.dto';
import { PromocodesMutationsService } from './promocodes-mutations.service';

/**
 * PRM-01 — admin-only promocode mutations (Plan 05).
 *
 * Routes:
 *   POST   /admin-api/v1/admin/promocodes       -> create     (admin)
 *   PATCH  /admin-api/v1/admin/promocodes/:id   -> update     (admin)
 *   DELETE /admin-api/v1/admin/promocodes/:id   -> hard delete (admin)
 *
 * RBAC: admin-only. Curator/teacher excluded at @Roles + PROMOCODE_SCOPE_RULES default-deny.
 *
 * Audit (D-17): every handler decorated with `@Audit('promocodes.<action>', 'promocode')`.
 * `ci:audit-required` enforces.
 *
 * Errors:
 *   - 409 'code_already_exists' on Prisma P2002 (unique on Promocode.code).
 *   - 400 'promocodes.expires_after_start_required' when expires_at <= start_date.
 */
@Controller('admin-api/v1/admin/promocodes')
@UseGuards(JwtGuard, RolesGuard)
export class PromocodesMutationsController {
    constructor(private readonly svc: PromocodesMutationsService) {}

    @Post()
    @Roles('admin')
    @Audit('promocodes.create', 'promocode')
    public async create(@CurrentUser() actor: AuthenticatedRequestUser, @Body() dto: UpsertPromocodeDto) {
        const data = await this.svc.create({ id: actor.id, role_name: actor.role_name }, dto);
        return apiResponse(1, 'created', 'promocodes.created', data);
    }

    @Patch(':id')
    @Roles('admin')
    @Audit('promocodes.update', 'promocode')
    public async update(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: UpsertPromocodeDto,
    ) {
        const data = await this.svc.update({ id: actor.id, role_name: actor.role_name }, id, dto);
        return apiResponse(1, 'ok', 'promocodes.updated', data);
    }

    @Delete(':id')
    @Roles('admin')
    @Audit('promocodes.delete', 'promocode')
    @HttpCode(HttpStatus.OK)
    public async remove(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
    ) {
        const data = await this.svc.hardDelete({ id: actor.id, role_name: actor.role_name }, id);
        return apiResponse(1, 'ok', 'promocodes.deleted', data);
    }
}
