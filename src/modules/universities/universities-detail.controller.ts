import { Controller, Get, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UniversitiesDetailService } from './universities-detail.service';

@Controller('admin-api/v1/admin/universities')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class UniversitiesDetailController {
    constructor(private readonly svc: UniversitiesDetailService) {}

    @Get(':id')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('universities.view')
    public async get(@Param('id', ParseIntPipe) id: number) {
        return this.svc.getDetail(id);
    }
}
