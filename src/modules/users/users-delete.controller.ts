import { Controller, Delete, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { Audit } from '../../common/audit/audit.decorator';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { UsersDetailService } from './users-detail.service';

/**
 * DELETE /admin-api/v1/admin/users/:id — admin-only soft-delete.
 *
 * Soft-delete only (stamps `deleted_at`) — see `UsersDetailService.softDelete` for why a
 * hard delete is unsafe (cascading FKs, including the referral self-relation).
 *
 * RBAC: admin only — deleting curators/teachers/students is a high-impact, auditable op.
 * Path/prefix convention matches the other users controllers (admin-api is not
 * setGlobalPrefix'd; the prefix is embedded per controller).
 *
 * Audit: `@Audit('users.delete', 'user')` — `ci:audit-required` enforces the decorator
 * on every non-GET handler.
 */
@Controller('admin-api/v1/admin/users')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class UsersDeleteController {
    constructor(private readonly detailService: UsersDetailService) {}

    @Delete(':id')
    @Roles('admin')
    @RequirePermission('users.delete')
    @Audit('users.delete', 'user')
    public async remove(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
    ) {
        return this.detailService.softDelete({ id: actor.id, role_name: actor.role_name }, id);
    }
}
