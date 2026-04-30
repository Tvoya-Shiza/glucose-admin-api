import { Module } from '@nestjs/common';
import { UsersBulkController } from './users-bulk.controller';
import { UsersBulkService } from './users-bulk.service';
import { UsersDetailController } from './users-detail.controller';
import { UsersDetailService } from './users-detail.service';
import { UsersImportController } from './users-import.controller';
import { UsersImportService } from './users-import.service';
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
 * Wave 2 (Plan 04): UsersRoleController + UsersRoleService — admin-only role-change.
 * Wave 2 (Plan 05): UsersBulkController + UsersBulkService — bulk-provision
 *   (dry-run + commit) for course access grants. USR-04 + USR-05.
 * Wave 2 (this plan, 06): UsersImportController + UsersImportService — admin-only CSV
 *   import (dry-run + commit) with email-then-mobile idempotency. USR-06.
 * Plan 07 -> users-export.controller (proxies to geonline-api-export)
 */
@Module({
    imports: [],
    controllers: [
        UsersListController,
        UsersDetailController,
        UsersRoleController,
        UsersBulkController,
        UsersImportController,
    ],
    providers: [UsersListService, UsersDetailService, UsersRoleService, UsersBulkService, UsersImportService],
    exports: [UsersListService, UsersDetailService, UsersRoleService, UsersBulkService, UsersImportService],
})
export class UsersModule {}
