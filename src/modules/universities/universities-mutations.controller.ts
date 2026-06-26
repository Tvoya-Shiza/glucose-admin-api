import {
    Body,
    Controller,
    Delete,
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
import { UpsertUniversityDto } from './dto/upsert-university.dto';
import { UniversitiesMutationsService } from './universities-mutations.service';

@Controller('admin-api/v1/admin/universities')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class UniversitiesMutationsController {
    constructor(private readonly svc: UniversitiesMutationsService) {}

    @Post()
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('universities.create')
    @Audit('universities.create', 'university')
    public async create(@Body() dto: UpsertUniversityDto) {
        const data = await this.svc.create(dto);
        return apiResponse(1, 'created', 'universities.created', data);
    }

    @Patch(':id')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('universities.edit')
    @Audit('universities.update', 'university')
    public async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpsertUniversityDto) {
        const data = await this.svc.update(id, dto);
        return apiResponse(1, 'ok', 'universities.updated', data);
    }

    @Delete(':id')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('universities.delete')
    @Audit('universities.delete', 'university')
    @HttpCode(HttpStatus.OK)
    public async remove(@Param('id', ParseIntPipe) id: number) {
        const data = await this.svc.softDelete(id);
        return apiResponse(1, 'ok', 'universities.deleted', data);
    }
}
