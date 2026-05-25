import { Controller, Get, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CoursesPickerItemsService } from './courses-picker-items.service';
import { ListPickerItemsDto } from './dto/list-picker-items.dto';

/**
 * GET /admin-api/v1/admin/courses/:id/picker-items?kind=lesson|file|assignment|quiz
 *
 * Used by the schedules editor item-picker to fetch ONLY items belonging to the
 * schedule's bound course. Returns a uniform `{rows, total, page, page_size}`
 * shape regardless of kind so the client picker stays simple.
 *
 * RBAC: admin/curator/teacher with 'schedules.edit' — same audience that uses
 * the picker in the upsert dialog. No course scope (curators wouldn't pass
 * WEBINAR_SCOPE_RULES, but they DO edit schedules — locking them out of the
 * picker would block the whole flow).
 *
 * Audit: exempt (GET).
 */
@Controller('admin-api/v1/admin/courses')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class CoursesPickerItemsController {
    constructor(private readonly svc: CoursesPickerItemsService) {}

    @Get(':id/picker-items')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('schedules.edit')
    public async list(
        @Param('id', ParseIntPipe) courseId: number,
        @Query() query: ListPickerItemsDto,
    ) {
        return this.svc.list(courseId, query);
    }
}
