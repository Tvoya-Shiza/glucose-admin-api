import { Controller, Get, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { apiResponse } from '../../common/utils/api-response';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BlogsDetailService } from './blogs-detail.service';

/**
 * BLG-01 — GET /admin-api/v1/admin/blogs/:id (Plan 04).
 *
 * Admin-only. apiResponse-wrapped detail: `{ success, status, message, data }`.
 *
 * Audit posture: GET endpoints are exempt from the @Audit lint.
 *
 * Path-resolution note: `/admin-api/v1/admin/blogs/categories` is owned by
 * BlogCategoriesController whose prefix is more specific; Nest matches longer-prefix
 * routes first, so `:id` here will not swallow `/categories`.
 */
@Controller('admin-api/v1/admin/blogs')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class BlogsDetailController {
    constructor(private readonly svc: BlogsDetailService) {}

    @Get(':id')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('blogs.view')
    public async getDetail(@Param('id', ParseIntPipe) id: number) {
        const data = await this.svc.getDetail(id);
        return apiResponse(1, 'ok', 'blogs.fetched', data);
    }
}
