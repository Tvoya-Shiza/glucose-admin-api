import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { CreditsListService } from './credits-list.service';
import { CalendarCreditsDto } from './dto/calendar-credits.dto';
import { ListCreditsDto } from './dto/list-credits.dto';

/**
 * Credit list + calendar reads (contract §credits CRUD).
 *
 * This controller is registered BEFORE the detail controller in
 * credits.module.ts so the static 'calendar' segment wins over ':id'.
 */
@Controller('admin-api/v1/admin/credits')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class CreditsListController {
    constructor(private readonly svc: CreditsListService) {}

    @Get()
    @Roles('admin', 'curator')
    @RequirePermission('credits.view')
    public async list(@CurrentUser() actor: AuthenticatedRequestUser, @Query() query: ListCreditsDto) {
        return this.svc.list({ id: actor.id, role_name: actor.role_name }, query);
    }

    @Get('calendar')
    @Roles('admin', 'curator')
    @RequirePermission('credits.view')
    public async calendar(@CurrentUser() actor: AuthenticatedRequestUser, @Query() query: CalendarCreditsDto) {
        return this.svc.calendar({ id: actor.id, role_name: actor.role_name }, query);
    }
}
