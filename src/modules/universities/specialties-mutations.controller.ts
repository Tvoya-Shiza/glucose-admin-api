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
import { UpsertSpecialtyDto } from './dto/upsert-specialty.dto';
import { SpecialtiesMutationsService } from './specialties-mutations.service';

@Controller('admin-api/v1/admin/specialties')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class SpecialtiesMutationsController {
    constructor(private readonly svc: SpecialtiesMutationsService) {}

    @Post()
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('specialties.create')
    @Audit('specialties.create', 'specialty')
    public async create(@Body() dto: UpsertSpecialtyDto) {
        const data = await this.svc.create(dto);
        return apiResponse(1, 'created', 'specialties.created', data);
    }

    @Patch(':id')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('specialties.edit')
    @Audit('specialties.update', 'specialty')
    public async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpsertSpecialtyDto) {
        const data = await this.svc.update(id, dto);
        return apiResponse(1, 'ok', 'specialties.updated', data);
    }

    @Delete(':id')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('specialties.delete')
    @Audit('specialties.delete', 'specialty')
    @HttpCode(HttpStatus.OK)
    public async remove(@Param('id', ParseIntPipe) id: number) {
        const data = await this.svc.softDelete(id);
        return apiResponse(1, 'ok', 'specialties.deleted', data);
    }
}
