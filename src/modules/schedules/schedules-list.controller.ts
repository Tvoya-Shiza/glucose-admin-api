import { Controller, Get, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { AnalyticsSchedulesDto } from './dto/analytics-schedules.dto';
import { CalendarSchedulesDto } from './dto/calendar-schedules.dto';
import { ListSchedulesDto } from './dto/list-schedules.dto';
import { SchedulesListService } from './schedules-list.service';

/**
 * Read endpoints for lesson schedules.
 *
 * Routes:
 *   GET /admin-api/v1/admin/schedules                  — paginated list
 *   GET /admin-api/v1/admin/schedules/calendar         — events intersecting [from, to]
 *   GET /admin-api/v1/admin/schedules/analytics        — aggregated counts + sparkline
 *   GET /admin-api/v1/admin/schedules/:id              — full detail
 *
 * Static segments (calendar / analytics) MUST be declared before `:id` for Nest's
 * route matcher to take the static-first path; otherwise `analytics` is read as
 * `id = 'analytics'` and ParseIntPipe 400s.
 *
 * RBAC: all three staff roles reach the route. Scope (schedules.scope.ts) narrows
 * non-admin actors to `curator_id = self`.
 */
@Controller('admin-api/v1/admin/schedules')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class SchedulesListController {
    constructor(private readonly svc: SchedulesListService) {}

    @Get('calendar')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('schedules.view')
    public async calendar(@CurrentUser() actor: AuthenticatedRequestUser, @Query() query: CalendarSchedulesDto) {
        return this.svc.calendar({ id: actor.id, role_name: actor.role_name }, query);
    }

    @Get('analytics')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('schedules.view')
    public async analytics(@CurrentUser() actor: AuthenticatedRequestUser, @Query() query: AnalyticsSchedulesDto) {
        return this.svc.analytics({ id: actor.id, role_name: actor.role_name }, query);
    }

    @Get()
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('schedules.view')
    public async list(@CurrentUser() actor: AuthenticatedRequestUser, @Query() query: ListSchedulesDto) {
        return this.svc.list({ id: actor.id, role_name: actor.role_name }, query);
    }

    @Get(':id')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('schedules.view')
    public async detail(@CurrentUser() actor: AuthenticatedRequestUser, @Param('id', ParseIntPipe) id: number) {
        return this.svc.detail({ id: actor.id, role_name: actor.role_name }, id);
    }
}
