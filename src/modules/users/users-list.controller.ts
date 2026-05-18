import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { ListUsersDto } from './dto/list-users.dto';
import { UsersListService } from './users-list.service';

/**
 * USR-01 — GET /admin-api/v1/admin/users.
 *
 * Returns the raw `UserListResponseDto` shape (NOT wrapped in apiResponse) per
 * glucose-admin-api/CLAUDE.md "List endpoints (Phase 3+) return `{ rows, total, ... }`
 * directly — TanStack Table on the admin-client consumes the raw shape." Our shape is
 * `{ rows, total, page, page_size, next_cursor }` per the locked DTO contract.
 *
 * Audit posture: GET endpoints are exempt from the @Audit lint (only POST/PUT/PATCH/DELETE
 * trip the requirement) — no decorator needed here. RBAC is admin/curator/teacher; scope is
 * narrowed in the service via USER_SCOPE_RULES.
 */
@Controller('admin-api/v1/admin/users')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class UsersListController {
    constructor(private readonly listService: UsersListService) {}

    @Get()
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('users.view')
    public async list(@CurrentUser() actor: AuthenticatedRequestUser, @Query() query: ListUsersDto) {
        return this.listService.list({ id: actor.id, role_name: actor.role_name }, query);
    }
}
