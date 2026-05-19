import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CronLock, CronLockService } from '../../common/decorators/cron-lock.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminNotificationsService } from '../notifications/admin-notifications.service';
import { TaskAssigneesService } from './task-assignees.service';

/**
 * Phase 12 — deadline reminder cron.
 *
 * Runs every 5 minutes. For each non-completed, non-deleted task with a due
 * date:
 *   - `due_at` ∈ [now, now+24h] → `task_due_soon` (creator + assignees)
 *     skipping if an unread `task_due_soon` was already emitted to the same
 *     user in the last 24h (anti-spam).
 *   - `due_at < now`            → `task_overdue` (creator + assignees)
 *     skipping if an unread `task_overdue` was emitted in the last 24h.
 *
 * `@CronLock` keeps only one PM2 instance running this per tick. TTL = 10
 * minutes (2× the cron interval).
 *
 * Backlog cap: 200 tasks per tick. A board with 200+ overdue items would never
 * fully drain in one tick — that's a feature, not a bug (notification storms
 * are an anti-pattern; spread the load).
 */
const TICK_LIMIT = 200;
const TWENTY_FOUR_HOURS = 24 * 60 * 60;

@Injectable()
export class BoardsCronService {
    private readonly logger = new Logger(BoardsCronService.name);

    constructor(
        public readonly cronLock: CronLockService,
        private readonly prisma: PrismaService,
        private readonly assignees: TaskAssigneesService,
        private readonly notifications: AdminNotificationsService,
    ) {}

    @Cron(CronExpression.EVERY_5_MINUTES)
    @CronLock('admin-task-deadlines', 600_000)
    public async fireDeadlineReminders(): Promise<void> {
        const nowSec = Math.floor(Date.now() / 1000);

        // Due-soon window: tasks coming due in the next 24h, not yet completed.
        const dueSoon = await this.prisma.kanbanTask.findMany({
            where: {
                deleted_at: null,
                completed_at: null,
                due_at: { gte: nowSec, lte: nowSec + TWENTY_FOUR_HOURS },
            },
            select: { id: true, title: true, board_id: true, creator_id: true, due_at: true },
            take: TICK_LIMIT,
        });

        for (const t of dueSoon) {
            try {
                await this.emitForTask(t, 'task_due_soon', nowSec);
            } catch (err) {
                this.logger.warn(`due_soon task=${t.id.toString()} failed: ${(err as Error)?.message}`);
            }
        }

        // Overdue: past due, not completed. Use updated_at index... actually scan via due_at.
        const overdue = await this.prisma.kanbanTask.findMany({
            where: { deleted_at: null, completed_at: null, due_at: { lt: nowSec } },
            select: { id: true, title: true, board_id: true, creator_id: true, due_at: true },
            take: TICK_LIMIT,
        });

        for (const t of overdue) {
            try {
                await this.emitForTask(t, 'task_overdue', nowSec);
            } catch (err) {
                this.logger.warn(`overdue task=${t.id.toString()} failed: ${(err as Error)?.message}`);
            }
        }
    }

    private async emitForTask(
        t: { id: bigint; title: string; board_id: number; creator_id: number; due_at: number | null },
        category: 'task_due_soon' | 'task_overdue',
        nowSec: number,
    ): Promise<void> {
        const expanded = await this.assignees.expandAssigneesToUserIds(t.id);
        const recipients = Array.from(new Set([t.creator_id, ...expanded]));
        if (recipients.length === 0) return;

        // Anti-spam: per-user, suppress if an unread notification of the same
        // category for the same task was emitted in the last 24h. JSON path
        // lookup on `payload->task_id` is the canonical anti-dupe check.
        const since = nowSec - TWENTY_FOUR_HOURS;
        const recentlyNotified = await this.prisma.adminNotification.findMany({
            where: {
                user_id: { in: recipients },
                category,
                created_at: { gte: since },
                // String() because BigInt → JSON serialises as string in our notifier payloads.
                payload: { path: '$.task_id', equals: String(t.id) },
            },
            select: { user_id: true },
        });
        const suppress = new Set(recentlyNotified.map((r) => r.user_id));
        const targets = recipients.filter((id) => !suppress.has(id));
        if (targets.length === 0) return;

        await this.notifications.createMany(targets, category, {
            task_id: String(t.id),
            board_id: t.board_id,
            title: t.title,
            due_at: t.due_at,
        });
    }
}
