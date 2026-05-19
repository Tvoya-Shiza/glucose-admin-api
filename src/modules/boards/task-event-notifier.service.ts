import { Injectable } from '@nestjs/common';
import type { AdminNotificationCategory } from '../../../generated/prisma';
import { AdminNotificationsService } from '../notifications/admin-notifications.service';
import { TaskAssigneesService } from './task-assignees.service';

/**
 * Domain-specific helper that translates Phase 12 task events into rows in
 * `admin_notifications`. Keeps the fan-out logic out of TasksService.
 *
 * Self-notification suppression: the actor who performs the action is excluded
 * from the recipient list — it'd be noise to ping yourself "you assigned this
 * task" or "you commented".
 *
 * Recipient sets:
 *   `task_assigned`        → newly-added assignees (diff vs. previous list, expanded)
 *   `task_column_changed`  → creator + all expanded assignees
 *   `task_comment`         → creator + all expanded assignees
 *   `task_due_soon`        → cron-driven (see boards-cron.service.ts Phase 4f)
 *   `task_overdue`         → cron-driven
 *   `task_completed`       → creator + all expanded assignees (not the actor)
 *   `board_invited`        → newly-added board members (excluding actor)
 */
@Injectable()
export class TaskEventNotifierService {
    constructor(
        private readonly assignees: TaskAssigneesService,
        private readonly notifications: AdminNotificationsService,
    ) {}

    public async notifyTaskAssigned(opts: {
        taskId: bigint;
        boardId: number;
        title: string;
        actorId: number;
        recipientUserIds: number[];
    }): Promise<void> {
        const filtered = unique(opts.recipientUserIds).filter((id) => id !== opts.actorId);
        if (filtered.length === 0) return;
        await this.emit(filtered, 'task_assigned', {
            task_id: String(opts.taskId),
            board_id: opts.boardId,
            title: opts.title,
            actor_id: opts.actorId,
        });
    }

    public async notifyTaskColumnChanged(opts: {
        taskId: bigint;
        boardId: number;
        title: string;
        actorId: number;
        creatorId: number;
        toColumnId: number;
        becameCompleted: boolean;
    }): Promise<void> {
        const recipients = unique([opts.creatorId, ...(await this.assignees.expandAssigneesToUserIds(opts.taskId))])
            .filter((id) => id !== opts.actorId);
        if (recipients.length === 0) return;
        const category: AdminNotificationCategory = opts.becameCompleted ? 'task_completed' : 'task_column_changed';
        await this.emit(recipients, category, {
            task_id: String(opts.taskId),
            board_id: opts.boardId,
            title: opts.title,
            actor_id: opts.actorId,
            to_column_id: opts.toColumnId,
        });
    }

    public async notifyTaskComment(opts: {
        taskId: bigint;
        boardId: number;
        title: string;
        actorId: number;
        creatorId: number;
    }): Promise<void> {
        const recipients = unique([opts.creatorId, ...(await this.assignees.expandAssigneesToUserIds(opts.taskId))])
            .filter((id) => id !== opts.actorId);
        if (recipients.length === 0) return;
        await this.emit(recipients, 'task_comment', {
            task_id: String(opts.taskId),
            board_id: opts.boardId,
            title: opts.title,
            actor_id: opts.actorId,
        });
    }

    public async notifyBoardInvited(opts: { boardId: number; actorId: number; newMemberIds: number[] }): Promise<void> {
        const filtered = unique(opts.newMemberIds).filter((id) => id !== opts.actorId);
        if (filtered.length === 0) return;
        await this.emit(filtered, 'board_invited', {
            board_id: opts.boardId,
            actor_id: opts.actorId,
        });
    }

    private async emit(
        recipientIds: number[],
        category: AdminNotificationCategory,
        payload: Record<string, unknown>,
    ): Promise<void> {
        await this.notifications.createMany(recipientIds, category, payload);
    }
}

function unique(arr: number[]): number[] {
    return Array.from(new Set(arr));
}
