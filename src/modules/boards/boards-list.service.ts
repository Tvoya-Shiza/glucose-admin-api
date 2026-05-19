import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma';
import { buildScopeWhere } from '../../common/scoping/scope.helper';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { BOARD_SCOPE_RULES } from './boards.scope';
import { ListBoardsDto } from './dto/list-boards.dto';

/**
 * Paginated, scoped board list. Each row carries lightweight aggregates
 * (`member_count`, `task_count`) so the boards-grid UI can render badges
 * without N+1 follow-up fetches.
 */
@Injectable()
export class BoardsListService {
    public static readonly DEFAULT_PAGE_SIZE = 50;
    public static readonly MAX_PAGE_SIZE = 200;

    constructor(private readonly prisma: PrismaService) {}

    public async list(actor: AuthenticatedRequestUser, query: ListBoardsDto) {
        const page = Math.max(1, query.page ?? 1);
        const page_size = Math.min(
            BoardsListService.MAX_PAGE_SIZE,
            Math.max(1, query.page_size ?? BoardsListService.DEFAULT_PAGE_SIZE),
        );
        const sort = query.sort ?? 'created_at';
        const order: 'asc' | 'desc' = query.order ?? 'desc';

        const where: Prisma.KanbanBoardWhereInput = {
            deleted_at: null,
            ...(buildScopeWhere({ id: actor.id, role_name: actor.role_name }, BOARD_SCOPE_RULES) as Prisma.KanbanBoardWhereInput),
        };

        if (query.status && query.status !== 'all') where.status = query.status;
        else if (!query.status) where.status = 'active';

        if (query.q && query.q.trim().length > 0) {
            where.name = { contains: query.q.trim() };
        }

        const orderBy: Prisma.KanbanBoardOrderByWithRelationInput =
            sort === 'name' ? { name: order } : { created_at: order };

        const [total, rows] = await this.prisma.$transaction([
            this.prisma.kanbanBoard.count({ where }),
            this.prisma.kanbanBoard.findMany({
                where,
                orderBy: [orderBy, { id: order }],
                skip: (page - 1) * page_size,
                take: page_size,
                select: {
                    id: true,
                    creator_id: true,
                    name: true,
                    description: true,
                    color: true,
                    status: true,
                    created_at: true,
                    updated_at: true,
                    _count: {
                        select: {
                            members: true,
                            tasks: { where: { deleted_at: null } },
                        },
                    },
                },
            }),
        ]);

        return {
            rows: rows.map((r) => ({
                id: r.id,
                creator_id: r.creator_id,
                name: r.name,
                description: r.description,
                color: r.color,
                status: r.status,
                created_at: r.created_at,
                updated_at: r.updated_at,
                member_count: r._count.members,
                task_count: r._count.tasks,
            })),
            total,
            page,
            page_size,
        };
    }
}
