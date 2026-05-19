import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { BoardAccessService } from './board-access.service';
import { CreateTaskCommentDto } from './dto/create-task-comment.dto';
import { UpdateTaskCommentDto } from './dto/update-task-comment.dto';
import { TaskActivityService } from './task-activity.service';
import { TaskEventNotifierService } from './task-event-notifier.service';
import { nowSec } from './utils/now-sec';

/**
 * Flat comments. Each create emits an in-app notification to the task creator
 * and every assignee (excluding the comment author).
 *
 * Authorisation:
 *   - create  : board editor + `tasks.comment` permission (controller-gated)
 *   - update  : original author only (or admin)
 *   - delete  : original author OR admin
 */
@Injectable()
export class TaskCommentsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly access: BoardAccessService,
        private readonly activity: TaskActivityService,
        private readonly notifier: TaskEventNotifierService,
    ) {}

    public async create(actor: AuthenticatedRequestUser, boardId: number, taskId: bigint, dto: CreateTaskCommentDto) {
        await this.access.assertViewer(actor, boardId);
        const task = await this.prisma.kanbanTask.findFirst({
            where: { id: taskId, board_id: boardId, deleted_at: null },
            select: { id: true, title: true, creator_id: true },
        });
        if (!task) throw new NotFoundException('task_not_found');

        const comment = await this.prisma.$transaction(async (tx) => {
            const row = await tx.kanbanTaskComment.create({
                data: {
                    task_id: taskId,
                    author_id: actor.id,
                    content: dto.content,
                    created_at: nowSec(),
                },
            });
            await this.activity.log(tx, taskId, actor.id, 'comment_added', { comment_id: String(row.id) });
            return row;
        });

        await this.notifier.notifyTaskComment({
            taskId,
            boardId,
            title: task.title,
            actorId: actor.id,
            creatorId: task.creator_id,
        });

        return this.shape(comment);
    }

    public async update(
        actor: AuthenticatedRequestUser,
        boardId: number,
        taskId: bigint,
        commentId: bigint,
        dto: UpdateTaskCommentDto,
    ) {
        await this.access.assertViewer(actor, boardId);
        const existing = await this.prisma.kanbanTaskComment.findFirst({
            where: { id: commentId, task_id: taskId, deleted_at: null },
        });
        if (!existing) throw new NotFoundException('comment_not_found');
        if (!this.access.isAdmin(actor) && existing.author_id !== actor.id) {
            throw new ForbiddenException('not_comment_author');
        }
        const updated = await this.prisma.kanbanTaskComment.update({
            where: { id: commentId },
            data: { content: dto.content, updated_at: nowSec() },
        });
        return this.shape(updated);
    }

    public async softDelete(actor: AuthenticatedRequestUser, boardId: number, taskId: bigint, commentId: bigint) {
        await this.access.assertViewer(actor, boardId);
        const existing = await this.prisma.kanbanTaskComment.findFirst({
            where: { id: commentId, task_id: taskId, deleted_at: null },
        });
        if (!existing) throw new NotFoundException('comment_not_found');
        if (!this.access.isAdmin(actor) && existing.author_id !== actor.id) {
            throw new ForbiddenException('not_comment_author');
        }
        await this.prisma.$transaction(async (tx) => {
            await tx.kanbanTaskComment.update({
                where: { id: commentId },
                data: { deleted_at: nowSec() },
            });
            await this.activity.log(tx, taskId, actor.id, 'comment_deleted', { comment_id: String(commentId) });
        });
        return { ok: true };
    }

    private shape(row: { id: bigint; author_id: number; content: string; created_at: number; updated_at: number | null }) {
        return {
            id: String(row.id),
            author_id: row.author_id,
            content: row.content,
            created_at: row.created_at,
            updated_at: row.updated_at,
        };
    }
}
