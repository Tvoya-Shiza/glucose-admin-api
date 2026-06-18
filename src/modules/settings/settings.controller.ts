import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { Audit } from '../../common/audit/audit.decorator';
import { apiResponse } from '../../common/utils/api-response';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UpdateUbtDateDto } from './dto/update-ubt-date.dto';
import { SettingsService } from './settings.service';

/**
 * Global app settings admin surface.
 *
 *   GET   /admin-api/v1/admin/settings/ubt-date
 *   PATCH /admin-api/v1/admin/settings/ubt-date
 *
 * RBAC: gated by the `settings.view` / `settings.edit` permissions. Admin is
 * super-bypass; curator/teacher need an explicit grant via the /access/roles UI.
 */
@Controller('admin-api/v1/admin/settings')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class SettingsController {
    constructor(private readonly svc: SettingsService) {}

    @Get('ubt-date')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('settings.view')
    public async getUbtDate() {
        const data = await this.svc.getUbtDate();

        return apiResponse(1, 'retrieved', 'admin.settings.retrieved', data);
    }

    @Patch('ubt-date')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('settings.edit')
    @Audit('settings.update', 'setting')
    public async updateUbtDate(@Body() dto: UpdateUbtDateDto) {
        const data = await this.svc.setUbtDate(dto.date);

        return apiResponse(1, 'updated', 'admin.settings.updated', data);
    }
}
