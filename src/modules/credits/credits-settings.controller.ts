import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { Audit } from '../../common/audit/audit.decorator';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreditsSettingsService } from './credits-settings.service';
import { UpdateResultTextsDto } from './dto/update-result-texts.dto';

/** Motivational result texts (contract §settings; gated by credits.texts_manage). */
@Controller('admin-api/v1/admin/credit-settings')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class CreditsSettingsController {
    constructor(private readonly svc: CreditsSettingsService) {}

    @Get('result-texts')
    @Roles('admin', 'curator')
    @RequirePermission('credits.texts_manage')
    public async getResultTexts() {
        return this.svc.getResultTexts();
    }

    @Patch('result-texts')
    @Roles('admin', 'curator')
    @RequirePermission('credits.texts_manage')
    @Audit('credits.texts_update', 'setting')
    public async updateResultTexts(@Body() dto: UpdateResultTextsDto) {
        return this.svc.updateResultTexts(dto);
    }
}
