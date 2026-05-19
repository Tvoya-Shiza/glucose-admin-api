import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { BoardAccessService } from './board-access.service';
import { AddTaskAttachmentDto } from './dto/add-task-attachment.dto';
import { TaskActivityService } from './task-activity.service';
import { nowSec } from './utils/now-sec';

/**
 * Task attachments are a junction table: a row links a task to an existing
 * `upload_assets.id` (ULID). File bytes already live on disk via the Phase 5
 * X-Upload-Token flow; this service only writes the join row.
 */
@Injectable()
export class TaskAttachmentsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly access: BoardAccessService,
        private readonly activity: TaskActivityService,
    ) {}

    public async add(actor: AuthenticatedRequestUser, boardId: number, taskId: bigint, dto: AddTaskAttachmentDto) {
        await this.access.assertEditor(actor, boardId);
        const task = await this.prisma.kanbanTask.findFirst({
            where: { id: taskId, board_id: boardId, deleted_at: null },
            select: { id: true },
        });
        if (!task) throw new NotFoundException('task_not_found');

        // The upload_assets row must exist. We don't enforce actor-owned (any board
        // editor can attach any file from the shared library — same as adding a
        // course image).
        const upload = await this.prisma.uploadAsset.findFirst({
            where: { id: dto.upload_asset_id, deleted_at: null },
            select: { id: true },
        });
        if (!upload) throw new BadRequestException('upload_asset_not_found');

        const row = await this.prisma.$transaction(async (tx) => {
            // Upsert-style: ignore duplicate (task, asset) pairs gracefully.
            const created = await tx.kanbanTaskAttachment.upsert({
                where: { uniq_kanban_task_attachments_task_asset: { task_id: taskId, upload_asset_id: dto.upload_asset_id } },
                create: {
                    task_id: taskId,
                    upload_asset_id: dto.upload_asset_id,
                    uploaded_by: actor.id,
                    created_at: nowSec(),
                },
                update: {},
            });
            await this.activity.log(tx, taskId, actor.id, 'attachment_added', {
                attachment_id: created.id,
                upload_asset_id: dto.upload_asset_id,
            });
            return created;
        });

        return this.shape(row);
    }

    public async remove(actor: AuthenticatedRequestUser, boardId: number, taskId: bigint, attachmentId: number) {
        await this.access.assertEditor(actor, boardId);
        const existing = await this.prisma.kanbanTaskAttachment.findFirst({
            where: { id: attachmentId, task_id: taskId },
        });
        if (!existing) throw new NotFoundException('attachment_not_found');

        await this.prisma.$transaction(async (tx) => {
            await tx.kanbanTaskAttachment.delete({ where: { id: attachmentId } });
            await this.activity.log(tx, taskId, actor.id, 'attachment_removed', {
                attachment_id: attachmentId,
            });
        });
        return { ok: true };
    }

    private shape(row: { id: number; upload_asset_id: string; uploaded_by: number; created_at: number }) {
        return {
            id: row.id,
            upload_asset_id: row.upload_asset_id,
            uploaded_by: row.uploaded_by,
            created_at: row.created_at,
        };
    }
}
