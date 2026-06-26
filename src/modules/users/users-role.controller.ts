import { Body, Controller, Param, ParseIntPipe, Patch, UseGuards } from '@nestjs/common';
import { Audit } from '../../common/audit/audit.decorator';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { ChangeRoleDto } from './dto/change-role.dto';
import { UsersRoleService } from './users-role.service';

/**
 * USR-03 (role-change half) — Plan 04.
 *
 * Single endpoint: `PATCH /admin-api/v1/admin/users/:id/role`.
 *
 * RBAC: runtime-driven — `@Roles('admin', 'curator', 'teacher')` + `@RequirePermission('users.edit')`.
 * Any granted role may change roles; the service enforces an anti-escalation guard so non-admins
 * cannot assign or alter the `admin` role.
 *
 * Audit: `@Audit('users.changeRole', 'user')` — `ci:audit-required` lint enforces this.
 *
 * Path matches the convention set by Plans 02 + 03: `admin-api/v1/admin/users` (admin-api
 * is not setGlobalPrefix'd; the `admin-api/` prefix is embedded per controller).
 */
@Controller('admin-api/v1/admin/users')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class UsersRoleController {
    constructor(private readonly roleService: UsersRoleService) {}

    @Patch(':id/role')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('users.edit')
    @Audit('users.changeRole', 'user')
    public async changeRole(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: ChangeRoleDto,
    ) {
        return this.roleService.changeRole({ id: actor.id, role_name: actor.role_name }, id, dto);
    }
}
