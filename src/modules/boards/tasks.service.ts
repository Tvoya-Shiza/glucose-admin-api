import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { KanbanTaskActivityAction } from '../../../generated/prisma';
import { Prisma } from '../../../generated/prisma';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { BoardAccessService } from './board-access.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { ListTasksDto } from './dto/list-tasks.dto';
import { MoveTaskDto } from './dto/move-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { TaskActivityService } from './task-activity.service';
import { TaskAssigneesService } from './task-assignees.service';
import { TaskEventNotifierService } from './task-event-notifier.service';
import { nowSec } from './utils/now-sec';

/**
 * Task CRUD + drag-drop move.
 *
 * BigInt IDs come back as `bigint` from Prisma; the controller layer serialises
 * to strings (`String(task.id)`) so the JSON wire format matches the admin-client
 * convention (CLAUDE.md: "BigInt-as-string from admin-api").
 *
 * `position` is densely re-numbered inside a transaction on every move so the
 * client can rely on contiguous 0..N values for drag-drop animations. Costly
 * only when a column has >100 tasks — acceptable for an MVP coordination tool.
 */
@Injectable()
export class TasksService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly access: BoardAccessService,
        private readonly assignees: TaskAssigneesService,
        private readonly activity: TaskActivityService,
        private readonly notifier: TaskEventNotifierService,
    ) {}

    public async list(actor: AuthenticatedRequestUser, boardId: number, query: ListTasksDto) {
        await this.access.assertViewer(actor, boardId);

        const where: Prisma.KanbanTaskWhereInput = { board_id: boardId, deleted_at: null };
        if (typeof query.column_id === 'number') where.column_id = query.column_id;
        if (query.priority) where.priority = query.priority;
        if (query.q && query.q.trim().length > 0) where.title = { contains: query.q.trim() };
        if (query.filter === 'created') where.creator_id = actor.id;
        if (query.filter === 'overdue') {
            where.completed_at = null;
            where.due_at = { lt: nowSec() };
        }
        if (query.filter === 'completed') where.completed_at = { not: null };
        if (typeof query.due_before === 'number') where.due_at = { lte: query.due_before };
        if (query.filter === 'mine') {
            where.assignees = { some: { assignee_type: 'user', assignee_id: actor.id } };
        }

        const rows = await this.prisma.kanbanTask.findMany({
            where,
            orderBy: [{ column_id: 'asc' }, { position: 'asc' }],
            include: {
                _count: { select: { assignees: true, comments: { where: { deleted_at: null } }, attachments: true, checklist: true } },
                assignees: { select: { assignee_type: true, assignee_id: true } },
                checklist: { select: { is_done: true } },
            },
            take: 1000, // sane upper bound — pagination on a single board is rare
        });

        return {
            rows: rows.map((t) => ({
                id: String(t.id),
                board_id: t.board_id,
                column_id: t.column_id,
                creator_id: t.creator_id,
                title: t.title,
                position: t.position,
                priority: t.priority,
                due_at: t.due_at,
                completed_at: t.completed_at,
                created_at: t.created_at,
                updated_at: t.updated_at,
                assignee_count: t._count.assignees,
                comment_count: t._count.comments,
                attachment_count: t._count.attachments,
                checklist_total: t._count.checklist,
                checklist_done: t.checklist.filter((c) => c.is_done).length,
                assignees: t.assignees,
            })),
        };
    }

    public async create(actor: AuthenticatedRequestUser, boardId: number, dto: CreateTaskDto) {
        await this.access.assertEditor(actor, boardId);
        const now = nowSec();

        // Resolve target column.
        const columnId = dto.column_id ?? (await this.firstColumnId(boardId));
        await this.assertColumnBelongsToBoard(boardId, columnId);

        const taskId = await this.prisma.$transaction(async (tx) => {
            const position = await this.endPosition(tx, boardId, columnId);
            const task = await tx.kanbanTask.create({
                data: {
                    board_id: boardId,
                    column_id: columnId,
                    creator_id: actor.id,
                    title: dto.title,
                    description: dto.description ?? null,
                    position,
                    priority: dto.priority ?? 'medium',
                    due_at: dto.due_at ?? null,
                    created_at: now,
                },
            });

            if (dto.assignees && dto.assignees.length > 0) {
                await this.assignees.replace(tx, task.id, actor.id, dto.assignees);
            }

            await this.activity.log(tx, task.id, actor.id, 'created', { title: dto.title });

            return task.id;
        });

        // Notifications: fire after the tx commits so we never write notification
        // rows for a task that failed to create. expandAssignees re-queries the
        // committed assignee rows.
        if (dto.assignees && dto.assignees.length > 0) {
            const recipients = await this.assignees.expandAssigneesToUserIds(taskId);
            await this.notifier.notifyTaskAssigned({
                taskId,
                boardId,
                title: dto.title,
                actorId: actor.id,
                recipientUserIds: recipients,
            });
        }

        return this.detail(actor, boardId, taskId);
    }

    public async detail(actor: AuthenticatedRequestUser, boardId: number, taskId: bigint) {
        await this.access.assertViewer(actor, boardId);

        const task = await this.prisma.kanbanTask.findFirst({
            where: { id: taskId, board_id: boardId, deleted_at: null },
            include: {
                assignees: true,
                checklist: { orderBy: { position: 'asc' } },
                attachments: true,
                comments: {
                    where: { deleted_at: null },
                    orderBy: { created_at: 'asc' },
                },
                activity: { orderBy: { created_at: 'desc' }, take: 100 },
            },
        });
        if (!task) throw new NotFoundException('task_not_found');

        return {
            id: String(task.id),
            board_id: task.board_id,
            column_id: task.column_id,
            creator_id: task.creator_id,
            title: task.title,
            description: task.description,
            position: task.position,
            priority: task.priority,
            due_at: task.due_at,
            completed_at: task.completed_at,
            created_at: task.created_at,
            updated_at: task.updated_at,
            assignees: task.assignees.map((a) => ({
                id: a.id,
                assignee_type: a.assignee_type,
                assignee_id: a.assignee_id,
                assigned_by: a.assigned_by,
                created_at: a.created_at,
            })),
            checklist: task.checklist.map((c) => ({
                id: c.id,
                title: c.title,
                is_done: c.is_done,
                position: c.position,
                completed_by: c.completed_by,
                completed_at: c.completed_at,
            })),
            attachments: task.attachments.map((a) => ({
                id: a.id,
                upload_asset_id: a.upload_asset_id,
                uploaded_by: a.uploaded_by,
                created_at: a.created_at,
            })),
            comments: task.comments.map((c) => ({
                id: String(c.id),
                author_id: c.author_id,
                content: c.content,
                created_at: c.created_at,
                updated_at: c.updated_at,
            })),
            activity: task.activity.map((a) => ({
                id: String(a.id),
                actor_id: a.actor_id,
                action: a.action,
                payload: a.payload,
                created_at: a.created_at,
            })),
        };
    }

    public async update(actor: AuthenticatedRequestUser, boardId: number, taskId: bigint, dto: UpdateTaskDto) {
        await this.access.assertEditor(actor, boardId);
        const existing = await this.prisma.kanbanTask.findFirst({
            where: { id: taskId, board_id: boardId, deleted_at: null },
        });
        if (!existing) throw new NotFoundException('task_not_found');

        const data: Prisma.KanbanTaskUpdateInput = { updated_at: nowSec() };
        const events: Array<{ action: KanbanTaskActivityAction; payload?: Record<string, unknown> }> = [];

        if (dto.title !== undefined && dto.title !== existing.title) {
            data.title = dto.title;
            events.push({ action: 'title_changed', payload: { from: existing.title, to: dto.title } });
        }
        if (dto.description !== undefined && dto.description !== existing.description) {
            data.description = dto.description ?? null;
            events.push({ action: 'description_changed' });
        }
        if (dto.priority !== undefined && dto.priority !== existing.priority) {
            data.priority = dto.priority;
            events.push({ action: 'priority_changed', payload: { from: existing.priority, to: dto.priority } });
        }
        if (dto.due_at !== undefined && dto.due_at !== existing.due_at) {
            data.due_at = dto.due_at ?? null;
            events.push({ action: 'due_at_changed', payload: { from: existing.due_at, to: dto.due_at } });
        }
        if (dto.completed !== undefined) {
            const nowCompleted = existing.completed_at !== null;
            if (dto.completed && !nowCompleted) {
                data.completed_at = nowSec();
                events.push({ action: 'completed' });
            } else if (!dto.completed && nowCompleted) {
                data.completed_at = null;
                events.push({ action: 'reopened' });
            }
        }

        await this.prisma.$transaction(async (tx) => {
            await tx.kanbanTask.update({ where: { id: taskId }, data });
            for (const e of events) {
                await this.activity.log(tx, taskId, actor.id, e.action, e.payload);
            }
        });

        return this.detail(actor, boardId, taskId);
    }

    public async move(actor: AuthenticatedRequestUser, boardId: number, taskId: bigint, dto: MoveTaskDto) {
        await this.access.assertEditor(actor, boardId);

        const task = await this.prisma.kanbanTask.findFirst({
            where: { id: taskId, board_id: boardId, deleted_at: null },
        });
        if (!task) throw new NotFoundException('task_not_found');

        await this.assertColumnBelongsToBoard(boardId, dto.column_id);
        const targetColumn = await this.prisma.kanbanColumn.findUnique({ where: { id: dto.column_id } });
        if (!targetColumn || targetColumn.deleted_at !== null) throw new NotFoundException('column_not_found');

        return this.prisma.$transaction(async (tx) => {
            const sameColumn = task.column_id === dto.column_id;
            const now = nowSec();

            // 1. Remove from source: shift all tasks with position > task.position down by 1.
            if (!sameColumn) {
                await tx.kanbanTask.updateMany({
                    where: { board_id: boardId, column_id: task.column_id, position: { gt: task.position }, deleted_at: null },
                    data: { position: { decrement: 1 } },
                });
            }

            // 2. Make room in target: shift tasks with position >= target down by 1.
            await tx.kanbanTask.updateMany({
                where: {
                    board_id: boardId,
                    column_id: dto.column_id,
                    position: { gte: dto.position },
                    deleted_at: null,
                    id: { not: taskId },
                },
                data: { position: { increment: 1 } },
            });

            // 3. Place the task. Use the "unchecked" update input so we can write
            //    `column_id` directly (the relational variant would force a `column:
            //    { connect: { id: ... } }` block, which is needlessly verbose here).
            const data: Prisma.KanbanTaskUncheckedUpdateInput = {
                column_id: dto.column_id,
                position: dto.position,
                updated_at: now,
            };
            if (targetColumn.is_done_column && task.completed_at === null) {
                data.completed_at = now;
            } else if (!targetColumn.is_done_column && task.completed_at !== null) {
                data.completed_at = null;
            }

            await tx.kanbanTask.update({ where: { id: taskId }, data });

            // 4. Activity log.
            if (!sameColumn) {
                await this.activity.log(tx, taskId, actor.id, 'column_changed', {
                    from_column_id: task.column_id,
                    to_column_id: dto.column_id,
                });
                if ('completed_at' in data) {
                    const action: KanbanTaskActivityAction = data.completed_at ? 'completed' : 'reopened';
                    await this.activity.log(tx, taskId, actor.id, action);
                }
            } else if (task.position !== dto.position) {
                await this.activity.log(tx, taskId, actor.id, 'position_changed');
            }

            return { sameColumn, becameCompleted: 'completed_at' in data && Boolean(data.completed_at) };
        }).then(async ({ sameColumn, becameCompleted }) => {
            if (!sameColumn) {
                await this.notifier.notifyTaskColumnChanged({
                    taskId,
                    boardId,
                    title: task.title,
                    actorId: actor.id,
                    creatorId: task.creator_id,
                    toColumnId: dto.column_id,
                    becameCompleted,
                });
            }
            return { ok: true };
        });
    }

    public async softDelete(actor: AuthenticatedRequestUser, boardId: number, taskId: bigint) {
        await this.access.assertEditor(actor, boardId);
        const task = await this.prisma.kanbanTask.findFirst({
            where: { id: taskId, board_id: boardId, deleted_at: null },
        });
        if (!task) throw new NotFoundException('task_not_found');

        await this.prisma.kanbanTask.update({
            where: { id: taskId },
            data: { deleted_at: nowSec() },
        });
        return { ok: true };
    }

    // -- helpers ---------------------------------------------------------------

    private async firstColumnId(boardId: number): Promise<number> {
        const col = await this.prisma.kanbanColumn.findFirst({
            where: { board_id: boardId, deleted_at: null },
            orderBy: { position: 'asc' },
            select: { id: true },
        });
        if (!col) throw new BadRequestException('board_has_no_columns');
        return col.id;
    }

    private async assertColumnBelongsToBoard(boardId: number, columnId: number): Promise<void> {
        const col = await this.prisma.kanbanColumn.findFirst({
            where: { id: columnId, board_id: boardId, deleted_at: null },
            select: { id: true },
        });
        if (!col) throw new BadRequestException('column_not_in_board');
    }

    private async endPosition(
        client: Prisma.TransactionClient,
        boardId: number,
        columnId: number,
    ): Promise<number> {
        const max = await client.kanbanTask.findFirst({
            where: { board_id: boardId, column_id: columnId, deleted_at: null },
            orderBy: { position: 'desc' },
            select: { position: true },
        });
        return max ? max.position + 1 : 0;
    }
}
