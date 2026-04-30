import { Module } from '@nestjs/common';
import { GroupsListController } from './groups-list.controller';
import { GroupsListService } from './groups-list.service';

/**
 * GroupsModule — controllers + providers added by Phase 4 Plans 02-04.
 *
 * Wave 1 (Plan 01): module skeleton + GROUP_SCOPE_RULES + DTOs + cache utils.
 * Wave 2 (Plan 02 — this): GroupsListController + GroupsListService + GroupsMutationsController
 *   /Service — server-paginated list + create/update/delete + cascade-preview.
 * Wave 3 (Plan 03): GroupsDetailController + GroupsDetailService —
 *   overview + supervisor change + members tab pagination.
 * Wave 4 (Plan 04): GroupsMembersController + GroupsMembersService —
 *   bulk add/remove members + member-progress aggregates.
 */
@Module({
    imports: [],
    controllers: [GroupsListController],
    providers: [GroupsListService],
    exports: [GroupsListService],
})
export class GroupsModule {}
