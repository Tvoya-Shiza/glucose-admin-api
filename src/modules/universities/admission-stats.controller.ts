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
import { apiResponse } from '../../common/utils/api-response';
import { Audit } from '../../common/audit/audit.decorator';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ListAdmissionStatsDto } from './dto/list-admission-stats.dto';
import { UpsertAdmissionStatDto } from './dto/upsert-admission-stat.dto';
import { AdmissionStatsService } from './admission-stats.service';

@Controller('admin-api/v1/admin/admission-stats')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class AdmissionStatsController {
    constructor(private readonly svc: AdmissionStatsService) {}

    @Get()
    @Roles('admin', 'curator')
    @RequirePermission('admission_stats.view')
    public async list(@Query() query: ListAdmissionStatsDto) {
        return this.svc.list(query);
    }

    @Post()
    @Roles('admin')
    @RequirePermission('admission_stats.edit')
    @Audit('admission_stats.upsert', 'admission_stat')
    public async upsert(@Body() dto: UpsertAdmissionStatDto) {
        const data = await this.svc.upsert(dto);
        return apiResponse(1, 'ok', 'admission_stats.upserted', data);
    }

    @Patch(':id')
    @Roles('admin')
    @RequirePermission('admission_stats.edit')
    @Audit('admission_stats.update', 'admission_stat')
    public async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpsertAdmissionStatDto) {
        const data = await this.svc.update(id, dto);
        return apiResponse(1, 'ok', 'admission_stats.updated', data);
    }

    @Delete(':id')
    @Roles('admin')
    @RequirePermission('admission_stats.edit')
    @Audit('admission_stats.delete', 'admission_stat')
    @HttpCode(HttpStatus.OK)
    public async remove(@Param('id', ParseIntPipe) id: number) {
        const data = await this.svc.remove(id);
        return apiResponse(1, 'ok', 'admission_stats.deleted', data);
    }
}
