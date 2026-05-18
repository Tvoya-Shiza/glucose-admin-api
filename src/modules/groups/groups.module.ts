import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { GroupsDetailController } from './groups-detail.controller';
import { GroupsDetailService } from './groups-detail.service';
import { GroupsListController } from './groups-list.controller';
import { GroupsListService } from './groups-list.service';
import { GroupsMembersController } from './groups-members.controller';
import { GroupsMembersService } from './groups-members.service';
import { GroupsMutationsController } from './groups-mutations.controller';
import { GroupsMutationsService } from './groups-mutations.service';
import { GroupsSupervisorController } from './groups-supervisor.controller';
import { GroupsSupervisorService } from './groups-supervisor.service';

/**
 * GroupsModule — controllers + providers added by Phase 4 Plans 02-04.
 *
 * Wave 1 (Plan 01): module skeleton + GROUP_SCOPE_RULES + DTOs + cache utils.
 * Wave 2 (Plan 02): GroupsListController + GroupsListService + GroupsMutationsController
 *   /Service — server-paginated list + create/update/delete + cascade-preview.
 * Wave 3 (Plan 03): GroupsDetailController + GroupsDetailService — overview
 *   (GRP-05 explicit 403-not-404) + GroupsSupervisorController/Service — supervisor
 *   change (GRP-02) audited + atomic.
 * Wave 4 (Plan 04 — this): GroupsMembersController + GroupsMembersService —
 *   bulk add/remove members + member-progress aggregates (GRP-03 + GRP-06).
 */
@Module({
    imports: [AccessModule],
    controllers: [
        GroupsListController,
        GroupsMutationsController,
        GroupsDetailController,
        GroupsSupervisorController,
        GroupsMembersController,
    ],
    providers: [
        GroupsListService,
        GroupsMutationsService,
        GroupsDetailService,
        GroupsSupervisorService,
        GroupsMembersService,
    ],
    exports: [
        GroupsListService,
        GroupsMutationsService,
        GroupsDetailService,
        GroupsSupervisorService,
        GroupsMembersService,
    ],
})
export class GroupsModule {}
