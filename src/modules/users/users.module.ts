import { Module } from '@nestjs/common';
import { UsersListController } from './users-list.controller';
import { UsersListService } from './users-list.service';

/**
 * UsersModule — controllers + providers added by Phase 3 Plans 02-07.
 *
 * Wave 1 (Plan 01): module skeleton + scope rules + DTOs + utils.
 * Wave 2 (this plan, 02): UsersListController + UsersListService — server-paginated list.
 * Plan 03 -> user-detail.controller + user-detail.service (360 view, profile patch)
 * Plan 04 -> role-change.controller + role-change.service
 * Plan 05 -> bulk-provision.controller + bulk-provision.service (dry-run + commit)
 * Plan 06 -> users-import.controller + users-import.service (CSV)
 * Plan 07 -> users-export.controller (proxies to geonline-api-export)
 */
@Module({
    imports: [],
    controllers: [UsersListController],
    providers: [UsersListService],
    exports: [UsersListService],
})
export class UsersModule {}
