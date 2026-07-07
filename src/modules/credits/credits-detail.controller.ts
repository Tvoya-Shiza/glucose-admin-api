import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { CreditsDetailService } from './credits-detail.service';
import { CreditHistoryDto } from './dto/credit-history.dto';
import { parseBigIntId } from './utils/ids';

/**
 * Credit detail reads (contract §credits CRUD). Registered AFTER the list
 * controller (its static 'calendar' route must precede ':id').
 */
@Controller('admin-api/v1/admin/credits')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class CreditsDetailController {
    constructor(private readonly svc: CreditsDetailService) {}

    @Get(':id')
    @Roles('admin', 'curator')
    @RequirePermission('credits.view')
    public async detail(@CurrentUser() actor: AuthenticatedRequestUser, @Param('id') idRaw: string) {
        return this.svc.detail({ id: actor.id, role_name: actor.role_name }, parseBigIntId(idRaw));
    }

    @Get(':id/history')
    @Roles('admin', 'curator')
    @RequirePermission('credits.results_view')
    public async history(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id') idRaw: string,
        @Query() query: CreditHistoryDto,
    ) {
        return this.svc.history({ id: actor.id, role_name: actor.role_name }, parseBigIntId(idRaw), query);
    }

    @Get(':id/eligible-students')
    @Roles('admin', 'curator')
    @RequirePermission('credits.view')
    public async eligibleStudents(@CurrentUser() actor: AuthenticatedRequestUser, @Param('id') idRaw: string) {
        return this.svc.eligibleStudents({ id: actor.id, role_name: actor.role_name }, parseBigIntId(idRaw));
    }
}
