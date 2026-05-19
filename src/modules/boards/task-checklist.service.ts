import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { BoardAccessService } from './board-access.service';
import { CreateChecklistItemDto } from './dto/create-checklist-item.dto';
import { UpdateChecklistItemDto } from './dto/update-checklist-item.dto';
import { TaskActivityService } from './task-activity.service';
import { nowSec } from './utils/now-sec';

@Injectable()
export class TaskChecklistService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly access: BoardAccessService,
        private readonly activity: TaskActivityService,
    ) {}

    public async create(actor: AuthenticatedRequestUser, boardId: number, taskId: bigint, dto: CreateChecklistItemDto) {
        await this.access.assertEditor(actor, boardId);
        await this.assertTask(boardId, taskId);

        const now = nowSec();
        return this.prisma.$transaction(async (tx) => {
            const last = await tx.kanbanTaskChecklistItem.findFirst({
                where: { task_id: taskId },
                orderBy: { position: 'desc' },
                select: { position: true },
            });
            const item = await tx.kanbanTaskChecklistItem.create({
                data: {
                    task_id: taskId,
                    title: dto.title,
                    position: last ? last.position + 1 : 0,
                    created_at: now,
                },
            });
            await this.activity.log(tx, taskId, actor.id, 'checklist_added', { title: dto.title });
            return this.shape(item);
        });
    }

    public async update(
        actor: AuthenticatedRequestUser,
        boardId: number,
        taskId: bigint,
        itemId: number,
        dto: UpdateChecklistItemDto,
    ) {
        await this.access.assertEditor(actor, boardId);
        const existing = await this.prisma.kanbanTaskChecklistItem.findFirst({
            where: { id: itemId, task_id: taskId },
        });
        if (!existing) throw new NotFoundException('checklist_item_not_found');

        const data: Prisma.KanbanTaskChecklistItemUpdateInput = { updated_at: nowSec() };
        if (dto.title !== undefined) data.title = dto.title;

        let toggledTo: boolean | null = null;
        if (dto.is_done !== undefined && dto.is_done !== existing.is_done) {
            data.is_done = dto.is_done;
            data.completed_at = dto.is_done ? nowSec() : null;
            data.completed_by = dto.is_done ? actor.id : null;
            toggledTo = dto.is_done;
        }

        const item = await this.prisma.$transaction(async (tx) => {
            const updated = await tx.kanbanTaskChecklistItem.update({ where: { id: itemId }, data });
            if (toggledTo !== null) {
                await this.activity.log(
                    tx,
                    taskId,
                    actor.id,
                    toggledTo ? 'checklist_completed' : 'checklist_uncompleted',
                    { item_id: itemId },
                );
            }
            return updated;
        });

        return this.shape(item);
    }

    public async remove(actor: AuthenticatedRequestUser, boardId: number, taskId: bigint, itemId: number) {
        await this.access.assertEditor(actor, boardId);
        const existing = await this.prisma.kanbanTaskChecklistItem.findFirst({
            where: { id: itemId, task_id: taskId },
        });
        if (!existing) throw new NotFoundException('checklist_item_not_found');

        await this.prisma.$transaction(async (tx) => {
            await tx.kanbanTaskChecklistItem.delete({ where: { id: itemId } });
            await this.activity.log(tx, taskId, actor.id, 'checklist_removed', { item_id: itemId });
        });
        return { ok: true };
    }

    private async assertTask(boardId: number, taskId: bigint): Promise<void> {
        const task = await this.prisma.kanbanTask.findFirst({
            where: { id: taskId, board_id: boardId, deleted_at: null },
            select: { id: true },
        });
        if (!task) throw new NotFoundException('task_not_found');
    }

    private shape(row: {
        id: number;
        title: string;
        is_done: boolean;
        position: number;
        completed_by: number | null;
        completed_at: number | null;
    }) {
        return {
            id: row.id,
            title: row.title,
            is_done: row.is_done,
            position: row.position,
            completed_by: row.completed_by,
            completed_at: row.completed_at,
        };
    }
}
