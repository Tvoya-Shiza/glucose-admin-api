import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma';
import { PrismaService } from '../../prisma/prisma.service';
import { SetTaskAssigneesDto, TaskAssigneeDto } from './dto/set-task-assignees.dto';
import { nowSec } from './utils/now-sec';

/**
 * Polymorphic assignee management. The wire shape is rich (user / role / group /
 * everyone); for filtering and notification fan-out the server still needs to
 * collapse it to a flat list of `user_id`s — see `expandAssigneesToUserIds`.
 *
 * Authorisation: callers (TasksService, controllers) already enforced
 * board-editor + `tasks.assign` before invoking these helpers.
 */
@Injectable()
export class TaskAssigneesService {
    constructor(private readonly prisma: PrismaService) {}

    public async list(taskId: bigint) {
        const rows = await this.prisma.kanbanTaskAssignee.findMany({ where: { task_id: taskId } });
        return rows.map((r) => ({
            id: r.id,
            assignee_type: r.assignee_type,
            assignee_id: r.assignee_id,
            assigned_by: r.assigned_by,
            created_at: r.created_at,
        }));
    }

    /**
     * Bulk-replace assignees. Returns the new flat list of user IDs that the
     * assignment now resolves to — callers feed this into the notifications
     * layer (`task_assigned` rows for newly-added users only — diffing handled
     * by the caller).
     */
    public async replace(
        client: PrismaService | Prisma.TransactionClient,
        taskId: bigint,
        actorId: number,
        items: TaskAssigneeDto[],
    ): Promise<void> {
        const now = nowSec();
        // Dedup by (type, id) — last write wins on duplicate keys.
        const seen = new Set<string>();
        const rows: Array<{ type: TaskAssigneeDto['assignee_type']; id: number | null }> = [];
        for (const item of items) {
            const id = item.assignee_type === 'everyone' ? null : (item.assignee_id ?? null);
            const key = `${item.assignee_type}:${id ?? 'null'}`;
            if (seen.has(key)) continue;
            seen.add(key);
            rows.push({ type: item.assignee_type, id });
        }

        await client.kanbanTaskAssignee.deleteMany({ where: { task_id: taskId } });
        if (rows.length > 0) {
            await client.kanbanTaskAssignee.createMany({
                data: rows.map((r) => ({
                    task_id: taskId,
                    assignee_type: r.type,
                    assignee_id: r.id,
                    assigned_by: actorId,
                    created_at: now,
                })),
            });
        }
    }

    /**
     * Expand polymorphic assignees to a flat, deduplicated list of `user_id`s.
     * Used by the notifications layer and the "my tasks" filter.
     *
     *   user      → that single user
     *   role      → every active user with that role_id
     *   group     → every member of that group (via group_users)
     *   everyone  → every active staff user (admin / curator / teacher and any
     *               custom role with `is_admin = 0` and `code IS NOT NULL`)
     */
    public async expandAssigneesToUserIds(taskId: bigint): Promise<number[]> {
        const rows = await this.prisma.kanbanTaskAssignee.findMany({
            where: { task_id: taskId },
            select: { assignee_type: true, assignee_id: true },
        });
        if (rows.length === 0) return [];

        const userIds = new Set<number>();
        const roleIds: number[] = [];
        const groupIds: number[] = [];
        let everyone = false;
        for (const r of rows) {
            if (r.assignee_type === 'user' && r.assignee_id !== null) userIds.add(r.assignee_id);
            else if (r.assignee_type === 'role' && r.assignee_id !== null) roleIds.push(r.assignee_id);
            else if (r.assignee_type === 'group' && r.assignee_id !== null) groupIds.push(r.assignee_id);
            else if (r.assignee_type === 'everyone') everyone = true;
        }

        if (everyone) {
            const staff = await this.prisma.user.findMany({
                where: { deleted_at: null, status: 'active', role: { code: { not: 'student' } } },
                select: { id: true },
            });
            for (const u of staff) userIds.add(u.id);
        } else {
            if (roleIds.length > 0) {
                const roleUsers = await this.prisma.user.findMany({
                    where: { role_id: { in: roleIds }, deleted_at: null, status: 'active' },
                    select: { id: true },
                });
                for (const u of roleUsers) userIds.add(u.id);
            }
            if (groupIds.length > 0) {
                const groupUsers = await this.prisma.groupUser.findMany({
                    where: { group_id: { in: groupIds } },
                    select: { user_id: true },
                });
                for (const gu of groupUsers) userIds.add(gu.user_id);
            }
        }

        return Array.from(userIds);
    }

    public async replaceAndCommit(
        taskId: bigint,
        actorId: number,
        dto: SetTaskAssigneesDto,
    ): Promise<void> {
        await this.replace(this.prisma, taskId, actorId, dto.assignees);
    }
}
