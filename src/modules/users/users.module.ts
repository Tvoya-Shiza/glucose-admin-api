import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { UsersAnalyticsController } from './users-analytics.controller';
import { UsersAnalyticsService } from './users-analytics.service';
import { UsersBulkController } from './users-bulk.controller';
import { UsersBulkService } from './users-bulk.service';
import { UsersCreateController } from './users-create.controller';
import { UsersCreateService } from './users-create.service';
import { UsersDeleteController } from './users-delete.controller';
import { UsersDetailController } from './users-detail.controller';
import { UsersDetailService } from './users-detail.service';
import { UsersExportController } from './users-export.controller';
import { UsersExportService } from './users-export.service';
import { UsersImportController } from './users-import.controller';
import { UsersImportService } from './users-import.service';
import { UsersListController } from './users-list.controller';
import { UsersListService } from './users-list.service';
import { UsersQuizzesController } from './users-quizzes.controller';
import { UsersQuizzesService } from './users-quizzes.service';
import { UsersRoleController } from './users-role.controller';
import { UsersRoleService } from './users-role.service';

/**
 * UsersModule — controllers + providers added by Phase 3 Plans 02-07 + the
 * analytics/quizzes/per-user-export surface (Plan 08).
 *
 * Controller ORDER matters: `UsersAnalyticsController` exposes `GET /analytics`
 * and MUST be registered BEFORE `UsersDetailController` (which owns `GET /:id`).
 * Nest registers controller routes in declaration order — putting `analytics`
 * after `:id` would let ParseIntPipe gulp the static segment and 400 it.
 *
 * Wave 1 (Plan 01): module skeleton + scope rules + DTOs + utils.
 * Wave 2 (Plan 02): UsersListController + UsersListService — server-paginated list.
 * Wave 2 (Plan 03): UsersDetailController + UsersDetailService — 360 detail page +
 *   profile patch + memberships patch + activity feed.
 * Wave 2 (Plan 04): UsersRoleController + UsersRoleService — admin-only role-change.
 * Wave 2 (Plan 05): UsersBulkController + UsersBulkService — bulk-provision
 *   (dry-run + commit) for course access grants. USR-04 + USR-05.
 * Wave 2 (Plan 06): UsersImportController + UsersImportService — admin-only CSV
 *   import (dry-run + commit) with email-then-mobile idempotency. USR-06.
 * Wave 2 (Plan 07): UsersExportController + UsersExportService — inline CSV/XLSX
 *   export of the filtered users list (50k cap, @Throttle 5/15min). USR-07.
 *   Worker offload to geonline-api-export deferred to Phase 9.
 * Wave 3 (Plan 08): UsersAnalyticsController/Service — KPI + registrations trend.
 *   UsersQuizzesController/Service — quiz access + results for the detail page.
 *   Per-user audit-report extension on UsersExportController.
 */
@Module({
    imports: [AccessModule],
    controllers: [
        // Static-path controllers BEFORE the `:id` controller — see header note.
        UsersAnalyticsController,
        UsersListController,
        UsersRoleController,
        UsersBulkController,
        UsersImportController,
        UsersExportController,
        UsersCreateController,
        UsersQuizzesController,
        // DELETE /:id — method-specific, no static-DELETE collisions; before detail for tidiness.
        UsersDeleteController,
        UsersDetailController,
    ],
    providers: [
        UsersListService,
        UsersDetailService,
        UsersRoleService,
        UsersBulkService,
        UsersImportService,
        UsersExportService,
        UsersCreateService,
        UsersAnalyticsService,
        UsersQuizzesService,
    ],
    exports: [
        UsersListService,
        UsersDetailService,
        UsersRoleService,
        UsersBulkService,
        UsersImportService,
        UsersExportService,
        UsersCreateService,
        UsersAnalyticsService,
        UsersQuizzesService,
    ],
})
export class UsersModule {}
