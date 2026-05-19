import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { BoardAccessService } from './board-access.service';
import { CreateBoardDto } from './dto/create-board.dto';
import { UpdateBoardDto } from './dto/update-board.dto';
import { nowSec } from './utils/now-sec';

/**
 * CRUD for `kanban_boards`. Default columns (`К выполнению` / `В работе` /
 * `Готово`) are seeded inside the create transaction so a board is never
 * usable without at least one column.
 *
 * Authorisation: `boards.create` permission gates POST; `boards.edit` +
 * board-membership gates PATCH; `boards.delete` + board-owner gates DELETE.
 * Admin (`is_super`) bypasses all membership checks via BoardAccessService.
 */
@Injectable()
export class BoardsService {
    private static readonly DEFAULT_COLUMNS: Array<{ name: string; position: number; is_done_column: boolean }> = [
        { name: 'К выполнению', position: 0, is_done_column: false },
        { name: 'В работе', position: 1, is_done_column: false },
        { name: 'Готово', position: 2, is_done_column: true },
    ];

    constructor(
        private readonly prisma: PrismaService,
        private readonly access: BoardAccessService,
    ) {}

    public async create(actor: AuthenticatedRequestUser, dto: CreateBoardDto) {
        const now = nowSec();
        return this.prisma.$transaction(async (tx) => {
            const board = await tx.kanbanBoard.create({
                data: {
                    creator_id: actor.id,
                    name: dto.name,
                    description: dto.description ?? null,
                    color: dto.color ?? null,
                    created_at: now,
                },
            });

            // Creator is implicitly an owner — no separate API call required.
            await tx.kanbanBoardMember.create({
                data: {
                    board_id: board.id,
                    user_id: actor.id,
                    role: 'owner',
                    added_by: actor.id,
                    created_at: now,
                },
            });

            await tx.kanbanColumn.createMany({
                data: BoardsService.DEFAULT_COLUMNS.map((c) => ({
                    board_id: board.id,
                    name: c.name,
                    position: c.position,
                    is_done_column: c.is_done_column,
                    created_at: now,
                })),
            });

            return this.shapeBoard(board);
        });
    }

    public async detail(actor: AuthenticatedRequestUser, boardId: number) {
        await this.access.assertViewer(actor, boardId);

        const board = await this.prisma.kanbanBoard.findUnique({
            where: { id: boardId },
            include: {
                columns: {
                    where: { deleted_at: null },
                    orderBy: { position: 'asc' },
                },
                _count: { select: { members: true, tasks: { where: { deleted_at: null } } } },
            },
        });
        if (!board || board.deleted_at !== null) throw new NotFoundException('board_not_found');

        return {
            ...this.shapeBoard(board),
            member_count: board._count.members,
            task_count: board._count.tasks,
            columns: board.columns.map((c) => ({
                id: c.id,
                name: c.name,
                color: c.color,
                position: c.position,
                wip_limit: c.wip_limit,
                is_done_column: c.is_done_column,
            })),
        };
    }

    public async update(actor: AuthenticatedRequestUser, boardId: number, dto: UpdateBoardDto) {
        await this.access.assertEditor(actor, boardId);

        const data: Prisma.KanbanBoardUpdateInput = { updated_at: nowSec() };
        if (dto.name !== undefined) data.name = dto.name;
        if (dto.description !== undefined) data.description = dto.description ?? null;
        if (dto.color !== undefined) data.color = dto.color ?? null;
        if (dto.status !== undefined) data.status = dto.status;

        const board = await this.prisma.kanbanBoard.update({ where: { id: boardId }, data });
        return this.shapeBoard(board);
    }

    public async softDelete(actor: AuthenticatedRequestUser, boardId: number) {
        await this.access.assertOwner(actor, boardId);
        await this.prisma.kanbanBoard.update({
            where: { id: boardId },
            data: { deleted_at: nowSec() },
        });
        return { ok: true };
    }

    private shapeBoard(board: {
        id: number;
        creator_id: number;
        name: string;
        description: string | null;
        color: string | null;
        status: 'active' | 'archived';
        created_at: number;
        updated_at: number | null;
    }) {
        return {
            id: board.id,
            creator_id: board.creator_id,
            name: board.name,
            description: board.description,
            color: board.color,
            status: board.status,
            created_at: board.created_at,
            updated_at: board.updated_at,
        };
    }
}
