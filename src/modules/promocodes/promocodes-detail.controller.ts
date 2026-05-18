import { Controller, Get, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { apiResponse } from '../../common/utils/api-response';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PromocodesDetailService } from './promocodes-detail.service';

/**
 * PRM-01 — GET /admin-api/v1/admin/promocodes/:id (Plan 05).
 *
 * Admin-only. apiResponse-wrapped detail: `{ success, status, message, data }`.
 *
 * Audit posture: GET endpoints are exempt from the `ci:audit-required` lint.
 */
@Controller('admin-api/v1/admin/promocodes')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class PromocodesDetailController {
    constructor(private readonly svc: PromocodesDetailService) {}

    @Get(':id')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('promocodes.view')
    public async getDetail(@Param('id', ParseIntPipe) id: number) {
        const data = await this.svc.getDetail(id);
        return apiResponse(1, 'ok', 'promocodes.fetched', data);
    }
}
