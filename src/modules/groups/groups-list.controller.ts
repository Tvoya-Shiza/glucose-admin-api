import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { ListGroupsDto } from './dto/list-groups.dto';
import { GroupsListService } from './groups-list.service';

/**
 * GRP-01 — GET /admin-api/v1/admin/groups.
 *
 * Returns the raw GroupListResponseDto shape (NOT wrapped in apiResponse) per
 * glucose-admin-api/CLAUDE.md "List endpoints (Phase 3+) return `{ rows, total, ... }`
 * directly — TanStack Table on the admin-client consumes the raw shape." Our shape is
 * `{ rows, total, page, page_size, next_cursor }` per the locked DTO contract.
 *
 * Audit posture: GET endpoints are exempt from the @Audit lint — no decorator needed here.
 *
 * RBAC: admin / curator / teacher all hit the route. The scope rule narrows visibility:
 *   - admin   -> all groups
 *   - curator -> groups they supervise (supervisor_id === actor.id)
 *   - teacher -> default-deny (id: { in: [] }) -> empty result
 *
 * Per CONTEXT D-18 the empty-state UI surfaces the appropriate copy ('You aren't assigned
 * to any group') for non-admin actors.
 */
@Controller('admin-api/v1/admin/groups')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class GroupsListController {
    constructor(private readonly listService: GroupsListService) {}

    @Get()
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('groups.view')
    public async list(@CurrentUser() actor: AuthenticatedRequestUser, @Query() query: ListGroupsDto) {
        return this.listService.list({ id: actor.id, role_name: actor.role_name }, query);
    }
}
