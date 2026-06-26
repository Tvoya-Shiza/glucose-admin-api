import { Controller, Get, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { apiResponse } from '../../common/utils/api-response';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BannersDetailService } from './banners-detail.service';

/**
 * BAN-01 — GET /admin-api/v1/admin/banners/:id (Plan 03).
 *
 * RBAC: runtime-driven via @RequirePermission('banners.view'). apiResponse-wrapped
 * detail: `{ success, status, message, data }`.
 *
 * Audit posture: GET endpoints are exempt from the @Audit lint.
 */
@Controller('admin-api/v1/admin/banners')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class BannersDetailController {
    constructor(private readonly svc: BannersDetailService) {}

    @Get(':id')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('banners.view')
    public async getDetail(@Param('id', ParseIntPipe) id: number) {
        const data = await this.svc.getDetail(id);
        return apiResponse(1, 'ok', 'banners.fetched', data);
    }
}
