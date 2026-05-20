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
import { Audit } from '../../common/audit/audit.decorator';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { UpdateScheduleDto } from './dto/update-schedule.dto';
import { SchedulesMutationsService } from './schedules-mutations.service';

/**
 * Write endpoints for lesson schedules.
 *
 *   POST   /admin-api/v1/admin/schedules
 *   PATCH  /admin-api/v1/admin/schedules/:id
 *   DELETE /admin-api/v1/admin/schedules/:id  (soft-delete)
 *
 * RBAC: admin / curator / teacher pass the route. The service enforces
 * ownership (`curator_id = self`) for non-admin actors.
 */
@Controller('admin-api/v1/admin/schedules')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class SchedulesMutationsController {
    constructor(private readonly svc: SchedulesMutationsService) {}

    @Post()
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('schedules.create')
    @Audit('schedules.create', 'schedule')
    public async create(@CurrentUser() actor: AuthenticatedRequestUser, @Body() dto: CreateScheduleDto) {
        return this.svc.create({ id: actor.id, role_name: actor.role_name }, dto);
    }

    @Patch(':id')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('schedules.edit')
    @Audit('schedules.update', 'schedule')
    public async update(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: UpdateScheduleDto,
    ) {
        return this.svc.update({ id: actor.id, role_name: actor.role_name }, id, dto);
    }

    @Delete(':id')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('schedules.delete')
    @Audit('schedules.delete', 'schedule')
    @HttpCode(HttpStatus.OK)
    public async remove(@CurrentUser() actor: AuthenticatedRequestUser, @Param('id', ParseIntPipe) id: number) {
        return this.svc.remove({ id: actor.id, role_name: actor.role_name }, id);
    }
}
