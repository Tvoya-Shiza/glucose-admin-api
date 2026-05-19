import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { BoardAccessService } from './board-access.service';
import { BoardMemberDto, SetBoardMembersDto } from './dto/set-board-members.dto';
import { nowSec } from './utils/now-sec';

/**
 * Member roster management for a board. The PUT shape is bulk-replace (idempotent)
 * — easier for the UI to reason about than diff-based PATCH and avoids the "add"
 * / "remove" / "change-role" tri-fork on the client.
 *
 * Invariant: every board MUST have at least one `owner` row. The service rejects
 * any payload that would leave the board ownerless.
 */
@Injectable()
export class BoardMembersService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly access: BoardAccessService,
    ) {}

    public async list(actor: AuthenticatedRequestUser, boardId: number) {
        await this.access.assertViewer(actor, boardId);

        const members = await this.prisma.kanbanBoardMember.findMany({
            where: { board_id: boardId },
            orderBy: [{ role: 'asc' }, { created_at: 'asc' }],
        });

        return {
            rows: members.map((m) => ({
                id: m.id,
                board_id: m.board_id,
                user_id: m.user_id,
                role: m.role,
                added_by: m.added_by,
                created_at: m.created_at,
            })),
        };
    }

    public async replace(actor: AuthenticatedRequestUser, boardId: number, dto: SetBoardMembersDto) {
        const { memberRole } = await this.access.assertViewer(actor, boardId);
        const isAdmin = this.access.isAdmin(actor);
        if (!isAdmin && memberRole !== 'owner') {
            throw new BadRequestException('board_owner_required');
        }

        // Dedupe by user_id (last write wins) + validate at least one owner remains.
        const byUser = new Map<number, BoardMemberDto>();
        for (const m of dto.members) {
            byUser.set(m.user_id, m);
        }
        const incoming = Array.from(byUser.values());
        if (!incoming.some((m) => m.role === 'owner')) {
            throw new BadRequestException('board_requires_owner');
        }

        const now = nowSec();
        return this.prisma.$transaction(async (tx) => {
            // Wipe & repaint — table is small (per-board bounded) so this is fine.
            await tx.kanbanBoardMember.deleteMany({ where: { board_id: boardId } });
            if (incoming.length > 0) {
                await tx.kanbanBoardMember.createMany({
                    data: incoming.map((m) => ({
                        board_id: boardId,
                        user_id: m.user_id,
                        role: m.role,
                        added_by: actor.id,
                        created_at: now,
                    })),
                });
            }
            return this.list(actor, boardId);
        });
    }
}
