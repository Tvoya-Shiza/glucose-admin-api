import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { BoardAccessService } from './board-access.service';
import { BoardMembersService } from './board-members.service';
import { BoardsCronService } from './boards-cron.service';
import { BoardsColumnsController } from './boards-columns.controller';
import { BoardsDetailController } from './boards-detail.controller';
import { BoardsListController } from './boards-list.controller';
import { BoardsListService } from './boards-list.service';
import { BoardsMembersController } from './boards-members.controller';
import { BoardsService } from './boards.service';
import { BoardsTasksAssigneesController } from './boards-tasks-assignees.controller';
import { BoardsTasksAttachmentsController } from './boards-tasks-attachments.controller';
import { BoardsTasksChecklistController } from './boards-tasks-checklist.controller';
import { BoardsTasksCommentsController } from './boards-tasks-comments.controller';
import { BoardsTasksController } from './boards-tasks.controller';
import { ColumnsService } from './columns.service';
import { TaskActivityService } from './task-activity.service';
import { TaskAssigneesService } from './task-assignees.service';
import { TaskAttachmentsService } from './task-attachments.service';
import { TaskChecklistService } from './task-checklist.service';
import { TaskCommentsService } from './task-comments.service';
import { TaskEventNotifierService } from './task-event-notifier.service';
import { TasksService } from './tasks.service';

/**
 * Phase 12 — Mini-Trello / kanban boards. Surface routes:
 *
 *   /admin-api/v1/admin/boards                                — list / create
 *   /admin-api/v1/admin/boards/:id                            — detail / patch / delete
 *   /admin-api/v1/admin/boards/:id/members                    — get / replace
 *   /admin-api/v1/admin/boards/:id/columns                    — create / reorder
 *   /admin-api/v1/admin/boards/:id/columns/:cid               — patch / delete
 *   /admin-api/v1/admin/boards/:id/tasks                      — list / create
 *   /admin-api/v1/admin/boards/:id/tasks/:tid                 — detail / patch / delete
 *   /admin-api/v1/admin/boards/:id/tasks/:tid/move            — drag-drop
 *   /admin-api/v1/admin/boards/:id/tasks/:tid/assignees       — bulk replace
 *
 * Phase 4 will add comments / checklist / attachments controllers + notifier
 * wiring. They share the existing services (BoardAccessService, TaskActivityService).
 *
 * `TaskAssigneesService` is exported because the Phase 4 NotificationsModule
 * uses `expandAssigneesToUserIds` to fan out notifications.
 */
@Module({
    imports: [AccessModule],
    controllers: [
        BoardsListController,
        BoardsDetailController,
        BoardsMembersController,
        BoardsColumnsController,
        BoardsTasksController,
        BoardsTasksAssigneesController,
        BoardsTasksCommentsController,
        BoardsTasksChecklistController,
        BoardsTasksAttachmentsController,
    ],
    providers: [
        BoardAccessService,
        BoardsService,
        BoardsListService,
        BoardMembersService,
        ColumnsService,
        TasksService,
        TaskAssigneesService,
        TaskActivityService,
        TaskEventNotifierService,
        TaskCommentsService,
        TaskChecklistService,
        TaskAttachmentsService,
        BoardsCronService,
    ],
    exports: [BoardAccessService, TaskAssigneesService, TaskActivityService, TaskEventNotifierService],
})
export class BoardsModule {}
