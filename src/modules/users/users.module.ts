import { Module } from '@nestjs/common';
import { UsersDetailController } from './users-detail.controller';
import { UsersDetailService } from './users-detail.service';
import { UsersListController } from './users-list.controller';
import { UsersListService } from './users-list.service';
import { UsersRoleController } from './users-role.controller';
import { UsersRoleService } from './users-role.service';

/**
 * UsersModule — controllers + providers added by Phase 3 Plans 02-07.
 *
 * Wave 1 (Plan 01): module skeleton + scope rules + DTOs + utils.
 * Wave 2 (Plan 02): UsersListController + UsersListService — server-paginated list.
 * Wave 2 (Plan 03): UsersDetailController + UsersDetailService — 360 detail page +
 *   profile patch + memberships patch + activity feed.
 * Wave 2 (this plan, 04): UsersRoleController + UsersRoleService — admin-only
 *   role-change endpoint with role_id + role_name atomic update + escalation guards.
 * Plan 05 -> bulk-provision.controller + bulk-provision.service (dry-run + commit)
 * Plan 06 -> users-import.controller + users-import.service (CSV)
 * Plan 07 -> users-export.controller (proxies to geonline-api-export)
 */
@Module({
    imports: [],
    controllers: [UsersListController, UsersDetailController, UsersRoleController],
    providers: [UsersListService, UsersDetailService, UsersRoleService],
    exports: [UsersListService, UsersDetailService, UsersRoleService],
})
export class UsersModule {}
