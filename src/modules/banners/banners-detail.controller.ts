import { Controller, Get, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { apiResponse } from '../../common/utils/api-response';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BannersDetailService } from './banners-detail.service';

/**
 * BAN-01 — GET /admin-api/v1/admin/banners/:id (Plan 03).
 *
 * Admin-only. apiResponse-wrapped detail: `{ success, status, message, data }`.
 *
 * Audit posture: GET endpoints are exempt from the @Audit lint.
 *
 * Routing note: this controller's `:id` route lives under the same prefix as
 * `BannerCategoriesController` (`/admin-api/v1/admin/banners/categories`). Nest
 * matches the longer literal prefix first, so `/categories` resolves to the
 * categories controller before Nest tries to ParseInt 'categories' here.
 */
@Controller('admin-api/v1/admin/banners')
@UseGuards(JwtGuard, RolesGuard)
export class BannersDetailController {
    constructor(private readonly svc: BannersDetailService) {}

    @Get(':id')
    @Roles('admin')
    public async getDetail(@Param('id', ParseIntPipe) id: number) {
        const data = await this.svc.getDetail(id);
        return apiResponse(1, 'ok', 'banners.fetched', data);
    }
}
