import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { ListUniversitiesDto } from './dto/list-universities.dto';
import { UniversitiesListService } from './universities-list.service';

@Controller('admin-api/v1/admin/universities')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class UniversitiesListController {
    constructor(private readonly svc: UniversitiesListService) {}

    @Get()
    @Roles('admin', 'curator')
    @RequirePermission('universities.view')
    public async list(@CurrentUser() actor: AuthenticatedRequestUser, @Query() query: ListUniversitiesDto) {
        return this.svc.list({ id: actor.id, role_name: actor.role_name }, query);
    }
}
