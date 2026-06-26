import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    ParseIntPipe,
    Post,
    Query,
    UseGuards,
} from '@nestjs/common';
import { Audit, SkipAudit } from '../../common/audit/audit.decorator';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { BulkMembersDto } from './dto/bulk-members.dto';
import { ListMembersDto, MemberProgressRequestDto } from './dto/member-progress.dto';
import { ResolveMembersDto } from './dto/resolve-members.dto';
import { GroupsMembersService } from './groups-members.service';

/**
 * GRP-03 + GRP-06 — group members endpoints (Plan 04, wave 4).
 *
 * Routes:
 *   GET    /admin-api/v1/admin/groups/:id/members           -> paginated member list
 *   POST   /admin-api/v1/admin/groups/:id/members           -> bulk add
 *   DELETE /admin-api/v1/admin/groups/:id/members           -> bulk remove
 *   POST   /admin-api/v1/admin/groups/:id/members/progress  -> per-member course progress
 *
 * RBAC:
 *   - GET + POST progress  : @Roles + @RequirePermission('groups.view'); service runs the
 *     3-step scope check (foreign-curator receives 403; teacher/other governed by grant).
 *   - POST + DELETE bulk   : @Roles + @RequirePermission('groups.edit'); same scope check
 *     keeps curator's per-tenant own-group narrowing.
 *
 * Audit:
 *   - POST   /:id/members           -> @Audit('groups.members.add', 'group_user')
 *   - DELETE /:id/members           -> @Audit('groups.members.remove', 'group_user')
 *   - POST   /:id/members/progress  -> @SkipAudit (read masquerading as POST)
 *   - GET    /:id/members           -> exempt (GET handler — audit lint ignores GETs)
 */
@Controller('admin-api/v1/admin/groups')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class GroupsMembersController {
    constructor(private readonly svc: GroupsMembersService) {}

    @Get(':id/members')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('groups.view')
    public async list(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
        @Query() query: ListMembersDto,
    ) {
        return this.svc.listMembers({ id: actor.id, role_name: actor.role_name }, id, query);
    }

    @Post(':id/members')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('groups.edit')
    @Audit('groups.members.add', 'group_user')
    public async bulkAdd(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: BulkMembersDto,
    ) {
        return this.svc.bulkAdd({ id: actor.id, role_name: actor.role_name }, id, dto);
    }

    @Delete(':id/members')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('groups.edit')
    @Audit('groups.members.remove', 'group_user')
    @HttpCode(HttpStatus.OK)
    public async bulkRemove(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: BulkMembersDto,
    ) {
        return this.svc.bulkRemove({ id: actor.id, role_name: actor.role_name }, id, dto);
    }

    @Post(':id/members/progress')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('groups.view')
    @SkipAudit('progress is a read masquerading as POST due to body shape; no mutation occurs')
    @HttpCode(HttpStatus.OK)
    public async progress(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: MemberProgressRequestDto,
    ) {
        return this.svc.progress({ id: actor.id, role_name: actor.role_name }, id, dto);
    }

    @Post(':id/members/resolve')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('groups.edit')
    @SkipAudit('read-only matching/resolution for Excel import; no mutation occurs')
    @HttpCode(HttpStatus.OK)
    public async resolve(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: ResolveMembersDto,
    ) {
        return this.svc.resolveMembers({ id: actor.id, role_name: actor.role_name }, id, dto);
    }
}
