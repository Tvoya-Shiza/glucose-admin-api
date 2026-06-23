import { Body, Controller, HttpCode, HttpStatus, Param, ParseIntPipe, Put, UseGuards } from '@nestjs/common';
import { Audit } from '../../common/audit/audit.decorator';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { SaveScheduleGridDto } from './dto/schedule-grid.dto';
import { SchedulesMutationsService } from './schedules-mutations.service';

/**
 * Per-course schedule GRID write surface (Phase 32).
 *
 *   PUT /admin-api/v1/admin/courses/:id/schedule-grid
 *
 * Bulk-saves the access-window grid (one single-item schedule per configured
 * module/lesson). Reads reuse the existing list endpoint (filtered by course_id).
 */
@Controller('admin-api/v1/admin/courses/:id/schedule-grid')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class SchedulesGridController {
    constructor(private readonly svc: SchedulesMutationsService) {}

    @Put()
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('schedules.edit')
    @Audit('schedules.grid_save', 'schedule')
    @HttpCode(HttpStatus.OK)
    public async save(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) courseId: number,
        @Body() dto: SaveScheduleGridDto,
    ) {
        return this.svc.bulkSaveGrid({ id: actor.id, role_name: actor.role_name }, courseId, dto);
    }
}
