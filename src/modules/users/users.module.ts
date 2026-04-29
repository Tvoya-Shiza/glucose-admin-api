import { Module } from '@nestjs/common';

/**
 * UsersModule — controllers + providers added by Phase 3 Plans 02-07.
 *
 * Wave 1 (this plan): empty registration so app.module.ts can import once and
 * downstream plans extend the existing module instead of racing on module creation.
 *
 * Wave 2:
 *   Plan 02 -> users-list.controller + users-list.service (server-paginated list)
 *   Plan 03 -> user-detail.controller + user-detail.service (360 view, profile patch)
 *   Plan 04 -> role-change.controller + role-change.service
 *   Plan 05 -> bulk-provision.controller + bulk-provision.service (dry-run + commit)
 *   Plan 06 -> users-import.controller + users-import.service (CSV)
 *   Plan 07 -> users-export.controller (proxies to geonline-api-export)
 */
@Module({
    imports: [],
    controllers: [],
    providers: [],
    exports: [],
})
export class UsersModule {}
