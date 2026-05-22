import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    ParseIntPipe,
    Patch,
    Post,
    Query,
    UseGuards,
} from '@nestjs/common';
import { Audit } from '../../common/audit/audit.decorator';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CourseCategoriesService } from './course-categories.service';
import { ListCourseCategoriesDto } from './dto/list-course-categories.dto';
import { UpsertCourseCategoryDto } from './dto/upsert-course-category.dto';

/**
 * CRUD on /admin-api/v1/admin/courses/categories.
 *
 *   GET    /                  -> list (admin / curator / teacher) — used by the
 *                                course-edit + course-create pickers AND by the
 *                                dedicated /kz/courses/categories management UI.
 *   POST   /                  -> create (admin / curator with `courses.create`)
 *   PATCH  /:id               -> update (admin / curator with `courses.edit`)
 *   DELETE /:id               -> delete (admin / curator with `courses.delete`).
 *                                Blocks via 409 when courses or child categories
 *                                still reference the row — no force-cascade by
 *                                design (operator must reassign first).
 *
 * Permission codes piggyback on the existing courses.* set rather than introducing
 * a new `courses.categories_manage` to avoid a permissions migration. Teachers are
 * intentionally excluded from mutations.
 *
 * Audit: every non-GET handler carries @Audit (CI lint `ci:audit-required` gates).
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

    @Post()
    @Roles('admin', 'curator')
    @RequirePermission('courses.create')
    @Audit('course_categories.create', 'course_category')
    public async create(@Body() dto: UpsertCourseCategoryDto) {
        return this.service.create(dto);
    }

    @Patch(':id')
    @Roles('admin', 'curator')
    @RequirePermission('courses.edit')
    @Audit('course_categories.update', 'course_category')
    public async update(
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: UpsertCourseCategoryDto,
    ) {
        return this.service.update(id, dto);
    }

    @Delete(':id')
    @Roles('admin', 'curator')
    @RequirePermission('courses.delete')
    @Audit('course_categories.delete', 'course_category')
    @HttpCode(HttpStatus.OK)
    public async remove(@Param('id', ParseIntPipe) id: number) {
        return this.service.remove(id);
    }
}
