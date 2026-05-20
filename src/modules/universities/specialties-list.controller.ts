import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ListSpecialtiesDto } from './dto/list-specialties.dto';
import { SpecialtiesListService } from './specialties-list.service';

@Controller('admin-api/v1/admin/specialties')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class SpecialtiesListController {
    constructor(private readonly svc: SpecialtiesListService) {}

    @Get()
    @Roles('admin', 'curator')
    @RequirePermission('specialties.view')
    public async list(@Query() query: ListSpecialtiesDto) {
        return this.svc.list(query);
    }
}
