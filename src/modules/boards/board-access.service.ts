import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';

/**
 * Shared authorization helpers for the boards module.
 *
 * Every mutating service hands off to one of these helpers before touching data.
 * They return the board row (or member row) so callers don't re-fetch.
 *
 * Authorization model:
 *   - admin (`role_name === 'admin'`) bypasses ALL membership checks — sees and
 *     mutates every board. Matches the AccessModule super-bypass rule.
 *   - non-admin must be a board member.
 *   - "owner" actions (delete board, change members) additionally require the
 *     member's `role` to be `owner`.
 *   - "editor" actions (create/edit columns, create/edit/move tasks, comments)
 *     require `role` in {`owner`, `editor`}.
 *   - "viewer" actions (read-only) require any membership.
 */
@Injectable()
export class BoardAccessService {
    constructor(private readonly prisma: PrismaService) {}

    public isAdmin(actor: AuthenticatedRequestUser): boolean {
        return actor.role_name === 'admin';
    }

    /**
     * Loads the board, returns it on success, 404 if missing / soft-deleted,
     * 403 if the actor is not an admin and not a member.
     */
    public async assertViewer(actor: AuthenticatedRequestUser, boardId: number) {
        const board = await this.prisma.kanbanBoard.findFirst({
            where: { id: boardId, deleted_at: null },
        });
        if (!board) throw new NotFoundException('board_not_found');
        if (this.isAdmin(actor)) return { board, memberRole: 'owner' as const };

        const member = await this.prisma.kanbanBoardMember.findUnique({
            where: { uniq_kanban_board_members_board_user: { board_id: boardId, user_id: actor.id } },
        });
        if (!member) throw new ForbiddenException('not_a_board_member');
        return { board, memberRole: member.role };
    }

    public async assertEditor(actor: AuthenticatedRequestUser, boardId: number) {
        const result = await this.assertViewer(actor, boardId);
        if (this.isAdmin(actor)) return result;
        if (result.memberRole === 'viewer') throw new ForbiddenException('board_role_insufficient');
        return result;
    }

    public async assertOwner(actor: AuthenticatedRequestUser, boardId: number) {
        const result = await this.assertViewer(actor, boardId);
        if (this.isAdmin(actor)) return result;
        if (result.memberRole !== 'owner') throw new ForbiddenException('board_owner_required');
        return result;
    }
}
