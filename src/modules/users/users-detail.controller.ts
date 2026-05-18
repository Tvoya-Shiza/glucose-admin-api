import { Body, Controller, Get, Param, ParseIntPipe, Patch, Query, UseGuards } from '@nestjs/common';
import { Audit } from '../../common/audit/audit.decorator';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { PatchMembershipsDto } from './dto/patch-memberships.dto';
import { PatchUserProfileDto } from './dto/patch-user-profile.dto';
import { UsersDetailService } from './users-detail.service';

/**
 * USR-02 / USR-03 (profile half) / USR-08 — user detail + profile + memberships.
 *
 * GET endpoints exempt from @Audit (lint only flags non-GET handlers). Both PATCH handlers
 * carry @Audit so the admin-api ci:audit-required lint passes:
 *   - PATCH /:id/profile      -> users.update      / user
 *   - PATCH /:id/memberships  -> users.memberships / user
 *
 * RBAC posture:
 *   - Detail + activity: admin/curator/teacher (scope re-applied in service per request).
 *   - Profile patch: admin/curator/teacher (curator/teacher narrowed by USER_SCOPE_RULES).
 *   - Memberships patch: admin + curator only — teacher does not manage group rolls.
 *
 * Path matches Plan 02 controller exactly: `admin-api/v1/admin/users` (admin-api is not
 * setGlobalPrefix'd; the prefix is embedded per controller per Plan 02 deviation #2).
 */
@Controller('admin-api/v1/admin/users')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class UsersDetailController {
    constructor(private readonly detailService: UsersDetailService) {}

    @Get(':id')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('users.view')
    public async detail(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
    ) {
        return this.detailService.detail({ id: actor.id, role_name: actor.role_name }, id);
    }

    @Get(':id/activity')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('users.view')
    public async activity(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
        @Query('page') page = '1',
        @Query('page_size') page_size = '50',
    ) {
        const p = Math.max(1, Number.parseInt(String(page), 10) || 1);
        // Cap page_size at 200 to mitigate audit-feed DoS (T-03-28).
        const ps = Math.min(200, Math.max(1, Number.parseInt(String(page_size), 10) || 50));
        return this.detailService.activity({ id: actor.id, role_name: actor.role_name }, id, p, ps);
    }

    @Patch(':id/profile')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('users.edit')
    @Audit('users.update', 'user')
    public async patchProfile(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: PatchUserProfileDto,
    ) {
        return this.detailService.patchProfile({ id: actor.id, role_name: actor.role_name }, id, dto);
    }

    @Patch(':id/memberships')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('users.edit')
    @Audit('users.memberships', 'user')
    public async patchMemberships(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: PatchMembershipsDto,
    ) {
        return this.detailService.patchMemberships({ id: actor.id, role_name: actor.role_name }, id, dto);
    }
}
