import { Controller, Get, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { ListAssignmentsDto } from './dto/list-assignments.dto';
import { AssignmentsListService } from './assignments-list.service';

/**
 * Read endpoints for assignments.
 *
 * Routes:
 *   GET /admin-api/v1/admin/assignments                    — paginated list (used by list page + course-content picker)
 *   GET /admin-api/v1/admin/assignments/analytics          — list-page dashboard metrics
 *   GET /admin-api/v1/admin/assignments/:id                — full detail with translations + attachments
 *   GET /admin-api/v1/admin/assignments/:id/analytics      — per-assignment analytics
 *
 * RBAC: admin / curator / teacher all reach the route. Access is governed by the
 * grantable @RequirePermission('assignments.view'); scope narrows at the service:
 *   - admin / teacher / curator: see all rows (scope omits these roles → {}).
 */
@Controller('admin-api/v1/admin/assignments')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class AssignmentsListController {
    constructor(private readonly svc: AssignmentsListService) {}

    @Get('analytics')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('assignments.view')
    public async globalAnalytics(@CurrentUser() actor: AuthenticatedRequestUser) {
        return this.svc.analytics({ id: actor.id, role_name: actor.role_name });
    }

    @Get()
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('assignments.view')
    public async list(@CurrentUser() actor: AuthenticatedRequestUser, @Query() query: ListAssignmentsDto) {
        return this.svc.list({ id: actor.id, role_name: actor.role_name }, query);
    }

    @Get(':id/analytics')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('assignments.view')
    public async perAssignmentAnalytics(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
    ) {
        return this.svc.analytics({ id: actor.id, role_name: actor.role_name }, id);
    }

    @Get(':id')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('assignments.view')
    public async detail(@CurrentUser() actor: AuthenticatedRequestUser, @Param('id', ParseIntPipe) id: number) {
        return this.svc.detail({ id: actor.id, role_name: actor.role_name }, id);
    }
}
