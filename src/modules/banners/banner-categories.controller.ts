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
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UpsertBannerCategoryDto } from './dto/upsert-banner-category.dto';
import { BannerCategoriesService } from './banner-categories.service';

/**
 * BAN-02 — AdvertisementCategory CRUD (Plan 03). Admin-only.
 *
 * Routes:
 *   GET    /admin-api/v1/admin/banners/categories         -> raw { rows }
 *   GET    /admin-api/v1/admin/banners/categories/:id     -> apiResponse-wrapped
 *   POST   /admin-api/v1/admin/banners/categories         -> apiResponse-wrapped
 *   PATCH  /admin-api/v1/admin/banners/categories/:id     -> apiResponse-wrapped
 *   DELETE /admin-api/v1/admin/banners/categories/:id     -> apiResponse-wrapped (400 on in-use)
 *
 * Note on routing: this controller's path prefix `/admin-api/v1/admin/banners/categories`
 * sits "underneath" `BannersDetailController`'s `/admin-api/v1/admin/banners/:id`. Nest
 * matches routes by specificity, so `/categories` resolves to this controller before
 * Nest tries to ParseInt 'categories' as an :id parameter on the detail controller.
 */
@Controller('admin-api/v1/admin/banners/categories')
@UseGuards(JwtGuard, RolesGuard)
export class BannerCategoriesController {
    constructor(private readonly svc: BannerCategoriesService) {}

    @Get()
    @Roles('admin')
    public async list() {
        return this.svc.list();
    }

    @Get(':id')
    @Roles('admin')
    public async getDetail(@Param('id', ParseIntPipe) id: number) {
        const data = await this.svc.getDetail(id);
        return apiResponse(1, 'ok', 'banners.category.fetched', data);
    }

    @Post()
    @Roles('admin')
    @Audit('banners.category.create', 'advertisement_category')
    public async create(@Body() dto: UpsertBannerCategoryDto) {
        const data = await this.svc.create(dto);
        return apiResponse(1, 'created', 'banners.category.created', data);
    }

    @Patch(':id')
    @Roles('admin')
    @Audit('banners.category.update', 'advertisement_category')
    public async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpsertBannerCategoryDto) {
        const data = await this.svc.update(id, dto);
        return apiResponse(1, 'ok', 'banners.category.updated', data);
    }

    @Delete(':id')
    @Roles('admin')
    @Audit('banners.category.delete', 'advertisement_category')
    @HttpCode(HttpStatus.OK)
    public async remove(@Param('id', ParseIntPipe) id: number) {
        const data = await this.svc.hardDelete(id);
        return apiResponse(1, 'ok', 'banners.category.deleted', data);
    }
}
