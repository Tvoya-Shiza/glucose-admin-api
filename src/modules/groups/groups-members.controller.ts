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
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { BulkMembersDto } from './dto/bulk-members.dto';
import { ListMembersDto, MemberProgressRequestDto } from './dto/member-progress.dto';
import { GroupsMembersService } from './groups-members.service';

/**
 * GRP-03 + GRP-06 — group members endpoints (Plan 04, wave 4).
 *
 * Routes:
 *   GET    /admin-api/v1/admin/groups/:id/members           -> paginated member list
 *   POST   /admin-api/v1/admin/groups/:id/members           -> bulk add (admin only)
 *   DELETE /admin-api/v1/admin/groups/:id/members           -> bulk remove (admin only)
 *   POST   /admin-api/v1/admin/groups/:id/members/progress  -> per-member course progress
 *
 * RBAC:
 *   - GET + POST progress  : admin / curator / teacher (service enforces 3-step scope
 *     check; foreign-curator and teacher receive 403, mirroring GroupsDetailController).
 *   - POST + DELETE bulk   : admin only (T-04-31 mitigation). Service carries a defensive
 *     belt-and-suspenders check for the same.
 *
 * Audit:
 *   - POST   /:id/members           -> @Audit('groups.members.add', 'group_user')
 *   - DELETE /:id/members           -> @Audit('groups.members.remove', 'group_user')
 *   - POST   /:id/members/progress  -> @SkipAudit (read masquerading as POST)
 *   - GET    /:id/members           -> exempt (GET handler — audit lint ignores GETs)
 */
@Controller('admin-api/v1/admin/groups')
@UseGuards(JwtGuard, RolesGuard)
export class GroupsMembersController {
    constructor(private readonly svc: GroupsMembersService) {}

    @Get(':id/members')
    @Roles('admin', 'curator', 'teacher')
    public async list(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
        @Query() query: ListMembersDto,
    ) {
        return this.svc.listMembers({ id: actor.id, role_name: actor.role_name }, id, query);
    }

    @Post(':id/members')
    @Roles('admin')
    @Audit('groups.members.add', 'group_user')
    public async bulkAdd(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: BulkMembersDto,
    ) {
        return this.svc.bulkAdd({ id: actor.id, role_name: actor.role_name }, id, dto);
    }

    @Delete(':id/members')
    @Roles('admin')
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
    @SkipAudit('progress is a read masquerading as POST due to body shape; no mutation occurs')
    @HttpCode(HttpStatus.OK)
    public async progress(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: MemberProgressRequestDto,
    ) {
        return this.svc.progress({ id: actor.id, role_name: actor.role_name }, id, dto);
    }
}
