import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Audit } from '../../common/audit/audit.decorator';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { CreditsLaunchService } from './credits-launch.service';
import { CreateLaunchDto } from './dto/create-launch.dto';
import { ListLaunchesDto } from './dto/list-launches.dto';
import { parseBigIntId } from './utils/ids';

/** Launch wizard + launches tab (contract §launches; all gated by credits.conduct). */
@Controller('admin-api/v1/admin/credits')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class CreditsLaunchController {
    constructor(private readonly svc: CreditsLaunchService) {}

    @Post(':id/launches')
    @Roles('admin', 'curator')
    @RequirePermission('credits.conduct')
    @Audit('credits.launch', 'credit_launch')
    public async create(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id') idRaw: string,
        @Body() dto: CreateLaunchDto,
    ) {
        return this.svc.create({ id: actor.id, role_name: actor.role_name }, parseBigIntId(idRaw), dto);
    }

    @Get(':creditId/launches')
    @Roles('admin', 'curator')
    @RequirePermission('credits.conduct')
    public async list(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('creditId') creditIdRaw: string,
        @Query() query: ListLaunchesDto,
    ) {
        return this.svc.listLaunches({ id: actor.id, role_name: actor.role_name }, parseBigIntId(creditIdRaw, 'creditId'), query);
    }

    @Get(':creditId/launches/:launchId')
    @Roles('admin', 'curator')
    @RequirePermission('credits.conduct')
    public async detail(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('creditId') creditIdRaw: string,
        @Param('launchId') launchIdRaw: string,
    ) {
        return this.svc.getLaunch(
            { id: actor.id, role_name: actor.role_name },
            parseBigIntId(creditIdRaw, 'creditId'),
            parseBigIntId(launchIdRaw, 'launchId'),
        );
    }
}
