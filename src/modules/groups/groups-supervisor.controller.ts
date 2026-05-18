import { Body, Controller, Param, ParseIntPipe, Patch, UseGuards } from '@nestjs/common';
import { Audit } from '../../common/audit/audit.decorator';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { ChangeSupervisorDto } from './dto/change-supervisor.dto';
import { GroupsSupervisorService } from './groups-supervisor.service';

/**
 * GRP-02 — admin-only supervisor change (Plan 03).
 *
 * Routes:
 *   PATCH /admin-api/v1/admin/groups/:id/supervisor   -> change supervisor (admin)
 *
 * RBAC: admin-only. Curator/teacher get 403 from RolesGuard before reaching the service.
 *
 * Audit: @Audit('groups.supervisor.change', 'group') — AuditInterceptor records the
 * full response shape (which includes `previous_supervisor_id` for before-state capture).
 *
 * supervisor_id contract (per ChangeSupervisorDto):
 *   - 0 means "clear assignment" (mapped to null in the service)
 *   - positive int = User.id; service validates the user is staff
 */
@Controller('admin-api/v1/admin/groups')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class GroupsSupervisorController {
    constructor(private readonly svc: GroupsSupervisorService) {}

    @Patch(':id/supervisor')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('groups.edit')
    @Audit('groups.supervisor.change', 'group')
    public async change(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: ChangeSupervisorDto,
    ) {
        return this.svc.change({ id: actor.id, role_name: actor.role_name }, id, dto);
    }
}
