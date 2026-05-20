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
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UpsertUniversitySpecialtyDto } from './dto/upsert-university-specialty.dto';
import { UniversitySpecialtiesService } from './university-specialties.service';

/**
 * Nested under /universities/:uid/specialties — link CRUD between a university
 * and the global Specialty directory. Per-link descriptions and has_rural_quota
 * flag live on UniversitySpecialty.
 */
@Controller('admin-api/v1/admin/universities/:uid/specialties')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class UniversitySpecialtiesController {
    constructor(private readonly svc: UniversitySpecialtiesService) {}

    @Get()
    @Roles('admin', 'curator')
    @RequirePermission('specialties.view')
    public async list(@Param('uid', ParseIntPipe) uid: number) {
        return this.svc.listForUniversity(uid);
    }

    @Post()
    @Roles('admin')
    @RequirePermission('specialties.create')
    @Audit('university_specialties.link', 'university_specialty')
    public async link(@Param('uid', ParseIntPipe) uid: number, @Body() dto: UpsertUniversitySpecialtyDto) {
        const data = await this.svc.link(uid, dto);
        return apiResponse(1, 'created', 'university_specialties.linked', data);
    }

    @Patch(':lid')
    @Roles('admin')
    @RequirePermission('specialties.edit')
    @Audit('university_specialties.update', 'university_specialty')
    public async update(
        @Param('uid', ParseIntPipe) _uid: number,
        @Param('lid', ParseIntPipe) lid: number,
        @Body() dto: UpsertUniversitySpecialtyDto,
    ) {
        const data = await this.svc.update(lid, dto);
        return apiResponse(1, 'ok', 'university_specialties.updated', data);
    }

    @Delete(':lid')
    @Roles('admin')
    @RequirePermission('specialties.delete')
    @Audit('university_specialties.unlink', 'university_specialty')
    @HttpCode(HttpStatus.OK)
    public async unlink(@Param('uid', ParseIntPipe) _uid: number, @Param('lid', ParseIntPipe) lid: number) {
        const data = await this.svc.unlink(lid);
        return apiResponse(1, 'ok', 'university_specialties.unlinked', data);
    }
}
