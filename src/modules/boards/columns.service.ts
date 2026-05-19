import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { BoardAccessService } from './board-access.service';
import { CreateColumnDto } from './dto/create-column.dto';
import { ReorderColumnsDto } from './dto/reorder-columns.dto';
import { UpdateColumnDto } from './dto/update-column.dto';
import { nowSec } from './utils/now-sec';

/**
 * Custom columns per board. Order is materialised in `position` (int, ascending).
 *
 * Delete semantics: column soft-delete (`deleted_at`) — surviving tasks reassigned
 * to the first remaining column on the board, so the kanban view never renders
 * orphaned tasks. Reorder is atomic via $transaction.
 */
@Injectable()
export class ColumnsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly access: BoardAccessService,
    ) {}

    public async create(actor: AuthenticatedRequestUser, boardId: number, dto: CreateColumnDto) {
        await this.access.assertEditor(actor, boardId);
        const now = nowSec();

        // position: if omitted, append to the end; if provided, shift siblings down.
        return this.prisma.$transaction(async (tx) => {
            const siblings = await tx.kanbanColumn.findMany({
                where: { board_id: boardId, deleted_at: null },
                select: { id: true, position: true },
                orderBy: { position: 'asc' },
            });
            let targetPos = dto.position ?? siblings.length;
            if (targetPos > siblings.length) targetPos = siblings.length;

            // Shift positions >= targetPos by +1
            for (const s of siblings) {
                if (s.position >= targetPos) {
                    await tx.kanbanColumn.update({ where: { id: s.id }, data: { position: s.position + 1 } });
                }
            }

            return tx.kanbanColumn.create({
                data: {
                    board_id: boardId,
                    name: dto.name,
                    color: dto.color ?? null,
                    position: targetPos,
                    wip_limit: dto.wip_limit ?? null,
                    is_done_column: dto.is_done_column ?? false,
                    created_at: now,
                },
            });
        });
    }

    public async update(actor: AuthenticatedRequestUser, boardId: number, columnId: number, dto: UpdateColumnDto) {
        await this.access.assertEditor(actor, boardId);
        const column = await this.prisma.kanbanColumn.findFirst({
            where: { id: columnId, board_id: boardId, deleted_at: null },
        });
        if (!column) throw new NotFoundException('column_not_found');

        const data: Prisma.KanbanColumnUpdateInput = { updated_at: nowSec() };
        if (dto.name !== undefined) data.name = dto.name;
        if (dto.color !== undefined) data.color = dto.color ?? null;
        if (dto.wip_limit !== undefined) data.wip_limit = dto.wip_limit ?? null;
        if (dto.is_done_column !== undefined) data.is_done_column = dto.is_done_column;

        return this.prisma.kanbanColumn.update({ where: { id: columnId }, data });
    }

    public async softDelete(actor: AuthenticatedRequestUser, boardId: number, columnId: number) {
        await this.access.assertEditor(actor, boardId);

        return this.prisma.$transaction(async (tx) => {
            const column = await tx.kanbanColumn.findFirst({
                where: { id: columnId, board_id: boardId, deleted_at: null },
            });
            if (!column) throw new NotFoundException('column_not_found');

            const remaining = await tx.kanbanColumn.findFirst({
                where: { board_id: boardId, deleted_at: null, id: { not: columnId } },
                orderBy: { position: 'asc' },
            });
            if (!remaining) {
                throw new BadRequestException('board_needs_at_least_one_column');
            }

            // Reassign tasks to the leftmost remaining column.
            await tx.kanbanTask.updateMany({
                where: { column_id: columnId, deleted_at: null },
                data: { column_id: remaining.id },
            });

            await tx.kanbanColumn.update({ where: { id: columnId }, data: { deleted_at: nowSec() } });
            return { ok: true, reassigned_to: remaining.id };
        });
    }

    public async reorder(actor: AuthenticatedRequestUser, boardId: number, dto: ReorderColumnsDto) {
        await this.access.assertEditor(actor, boardId);

        // Validate every column in the payload belongs to this board (defence in depth).
        const ids = dto.items.map((i) => i.id);
        const rows = await this.prisma.kanbanColumn.findMany({
            where: { id: { in: ids }, board_id: boardId, deleted_at: null },
            select: { id: true },
        });
        if (rows.length !== ids.length) throw new BadRequestException('column_set_mismatch');

        return this.prisma.$transaction(async (tx) => {
            for (const item of dto.items) {
                await tx.kanbanColumn.update({ where: { id: item.id }, data: { position: item.position } });
            }
            return { ok: true };
        });
    }
}
