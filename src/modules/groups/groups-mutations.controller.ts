import {
    Body,
    Controller,
    Delete,
    HttpCode,
    HttpStatus,
    Param,
    ParseIntPipe,
    Patch,
    Post,
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
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { GroupsMutationsService } from './groups-mutations.service';

/**
 * GRP-01 + GRP-04 + GRP-05 — group mutations + cascade-preview (Plan 02).
 *
 * Access is governed by @Roles + a grantable @RequirePermission per route
 * (groups.create / groups.edit / groups.delete). No per-tenant WRITE narrowing exists.
 *
 * Routes:
 *   POST   /admin-api/v1/admin/groups                 -> create        (groups.create)
 *   PATCH  /admin-api/v1/admin/groups/:id             -> update name/status (groups.edit)
 *   DELETE /admin-api/v1/admin/groups/:id             -> hard delete   (groups.delete)
 *   POST   /admin-api/v1/admin/groups/:id/cascade-preview -> dry-run   (groups.delete)
 *
 * Audit: every non-GET handler decorated. cascade-preview uses @SkipAudit with a
 * non-empty reason because it is a read-style operation (no DB mutation); the actual
 * DELETE is audited via @Audit('groups.delete','group'). The CI lint
 * `scripts/ci-audit-decorator-check.cjs` accepts @SkipAudit with a non-empty reason on
 * non-GET handlers.
 */
@Controller('admin-api/v1/admin/groups')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class GroupsMutationsController {
    constructor(private readonly svc: GroupsMutationsService) {}

    @Post()
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('groups.create')
    @Audit('groups.create', 'group')
    public async create(@CurrentUser() actor: AuthenticatedRequestUser, @Body() dto: CreateGroupDto) {
        return this.svc.create({ id: actor.id, role_name: actor.role_name }, dto);
    }

    @Patch(':id')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('groups.edit')
    @Audit('groups.update', 'group')
    public async update(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: UpdateGroupDto,
    ) {
        return this.svc.update({ id: actor.id, role_name: actor.role_name }, id, dto);
    }

    @Delete(':id')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('groups.delete')
    @Audit('groups.delete', 'group')
    @HttpCode(HttpStatus.OK)
    public async remove(@CurrentUser() actor: AuthenticatedRequestUser, @Param('id', ParseIntPipe) id: number) {
        return this.svc.hardDelete({ id: actor.id, role_name: actor.role_name }, id);
    }

    @Post(':id/cascade-preview')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('groups.delete')
    @SkipAudit('cascade-preview is a read-only inspection masquerading as POST due to body shape; the actual delete is audited via @Audit("groups.delete","group")')
    @HttpCode(HttpStatus.OK)
    public async cascadePreview(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
    ) {
        return this.svc.cascadePreview({ id: actor.id, role_name: actor.role_name }, id);
    }
}
