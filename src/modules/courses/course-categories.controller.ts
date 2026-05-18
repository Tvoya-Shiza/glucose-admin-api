import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CourseCategoriesService } from './course-categories.service';
import { ListCourseCategoriesDto } from './dto/list-course-categories.dto';

/**
 * GET /admin-api/v1/admin/courses/categories — read-only category list for the admin
 * course-create / course-edit pickers.
 *
 * Read endpoint → no `@Audit`. Available to admin / curator / teacher (creating a
 * course requires picking a category; all three roles can create courses per
 * USR / CRS scope rules).
 */
@Controller('admin-api/v1/admin/courses/categories')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class CourseCategoriesController {
    constructor(private readonly service: CourseCategoriesService) {}

    @Get()
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('courses.view')
    public async list(@Query() query: ListCourseCategoriesDto) {
        return this.service.list(query);
    }
}
