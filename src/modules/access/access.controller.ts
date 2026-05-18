import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    Param,
    ParseIntPipe,
    Patch,
    Post,
    Put,
    UseGuards,
} from '@nestjs/common';
import { Audit, SkipAudit } from '../../common/audit/audit.decorator';
import { apiResponse } from '../../common/utils/api-response';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { AccessService } from './access.service';
import { RequirePermission } from './decorators/require-permission.decorator';
import { CreateRoleDto } from './dto/create-role.dto';
import { SetRolePermissionsDto } from './dto/set-role-permissions.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { PermissionGuard } from './guards/permission.guard';

@Controller('admin-api/v1/admin/access')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class AccessController {
    constructor(private readonly svc: AccessService) {}

    @Get('roles')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('access.manage')
    @SkipAudit('read-only listing')
    public async listRoles() {
        const data = await this.svc.listRoles();
        return apiResponse(1, 'ok', 'admin.access.roles.list', { roles: data });
    }

    @Post('roles')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('access.manage')
    @Audit('access.role_create', 'role')
    @HttpCode(201)
    public async createRole(@CurrentUser() actor: AuthenticatedRequestUser, @Body() dto: CreateRoleDto) {
        const role = await this.svc.createRole(actor.id, dto);
        return apiResponse(1, 'created', 'admin.access.roles.created', { role });
    }

    @Patch('roles/:id')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('access.manage')
    @Audit('access.role_update', 'role')
    public async updateRole(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateRoleDto) {
        const role = await this.svc.updateRole(id, dto);
        return apiResponse(1, 'ok', 'admin.access.roles.updated', { role });
    }

    @Delete('roles/:id')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('access.manage')
    @Audit('access.role_delete', 'role')
    @HttpCode(200)
    public async deleteRole(@Param('id', ParseIntPipe) id: number) {
        await this.svc.deleteRole(id);
        return apiResponse(1, 'deleted', 'admin.access.roles.deleted');
    }

    @Get('permissions')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('access.manage')
    @SkipAudit('read-only catalog')
    public async listCatalog() {
        const groups = await this.svc.listCatalog();
        return apiResponse(1, 'ok', 'admin.access.permissions.list', { groups });
    }

    @Get('roles/:id/permissions')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('access.manage')
    @SkipAudit('read-only')
    public async getRolePermissions(@Param('id', ParseIntPipe) id: number) {
        const codes = await this.svc.getRolePermissionCodes(id);
        return apiResponse(1, 'ok', 'admin.access.role_permissions.get', { codes });
    }

    @Put('roles/:id/permissions')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('access.manage')
    @Audit('access.role_permissions_set', 'role')
    public async setRolePermissions(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: SetRolePermissionsDto,
    ) {
        const codes = await this.svc.setRolePermissions(id, dto.codes, actor.id);
        return apiResponse(1, 'ok', 'admin.access.role_permissions.set', { codes });
    }
}
