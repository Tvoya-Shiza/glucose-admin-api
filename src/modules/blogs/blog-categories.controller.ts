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
    UseGuards,
} from '@nestjs/common';
import { apiResponse } from '../../common/utils/api-response';
import { Audit } from '../../common/audit/audit.decorator';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UpsertBlogCategoryDto } from './dto/upsert-blog-category.dto';
import { BlogCategoriesService } from './blog-categories.service';

/**
 * BLG-02 — BlogCategory CRUD (Plan 04). Admin-only.
 *
 * Routes:
 *   GET    /admin-api/v1/admin/blogs/categories         -> raw { rows }
 *   GET    /admin-api/v1/admin/blogs/categories/:id     -> apiResponse-wrapped
 *   POST   /admin-api/v1/admin/blogs/categories         -> apiResponse-wrapped
 *   PATCH  /admin-api/v1/admin/blogs/categories/:id     -> apiResponse-wrapped
 *   DELETE /admin-api/v1/admin/blogs/categories/:id     -> apiResponse-wrapped (400 on in-use)
 *
 * Routing note: Nest matches routes in registration order (NOT by longest prefix).
 * This controller MUST be registered in BlogsModule BEFORE BlogsDetailController
 * (and any other `/admin/blogs/:id` controller) — otherwise GET /blogs/categories
 * lands in `@Get(':id')` with id="categories" and ParseIntPipe throws 400.
 * See blogs.module.ts controllers[] ordering.
 *
 * Schema-truth (Plan 01 lock): BlogCategory has NO `slug` column — diverges from
 * StoryCategory and AdvertisementCategory. CRUD shape omits slug.
 */
@Controller('admin-api/v1/admin/blogs/categories')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class BlogCategoriesController {
    constructor(private readonly svc: BlogCategoriesService) {}

    @Get()
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('blogs.view')
    public async list() {
        return this.svc.list();
    }

    @Get(':id')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('blogs.view')
    public async getDetail(@Param('id', ParseIntPipe) id: number) {
        const data = await this.svc.getDetail(id);
        return apiResponse(1, 'ok', 'blogs.category.fetched', data);
    }

    @Post()
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('blogs.categories_manage')
    @Audit('blogs.category.create', 'blog_category')
    public async create(@Body() dto: UpsertBlogCategoryDto) {
        const data = await this.svc.create(dto);
        return apiResponse(1, 'created', 'blogs.category.created', data);
    }

    @Patch(':id')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('blogs.categories_manage')
    @Audit('blogs.category.update', 'blog_category')
    public async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpsertBlogCategoryDto) {
        const data = await this.svc.update(id, dto);
        return apiResponse(1, 'ok', 'blogs.category.updated', data);
    }

    @Delete(':id')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('blogs.categories_manage')
    @Audit('blogs.category.delete', 'blog_category')
    @HttpCode(HttpStatus.OK)
    public async remove(@Param('id', ParseIntPipe) id: number) {
        const data = await this.svc.hardDelete(id);
        return apiResponse(1, 'ok', 'blogs.category.deleted', data);
    }
}
