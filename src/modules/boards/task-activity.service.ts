import { Injectable } from '@nestjs/common';
import type { KanbanTaskActivityAction } from '../../../generated/prisma';
import { Prisma } from '../../../generated/prisma';
import { PrismaService } from '../../prisma/prisma.service';
import { nowSec } from './utils/now-sec';

type TaskActivityAction = KanbanTaskActivityAction;

/**
 * Single-purpose logger for `kanban_task_activity` rows.
 *
 * Consumer pattern (use the Prisma tx client when called inside a transaction
 * so the activity row commits/rolls-back atomically with the mutation):
 *
 *   await tx.kanbanTaskComment.create({ data: ... });
 *   await this.activity.log(tx, taskId, actor.id, 'comment_added', { comment_id: ... });
 *
 * The `payload` is unstructured by design — different actions carry different
 * shapes (column_changed: `{ from_column_id, to_column_id }`; title_changed:
 * `{ from, to }`). Consumers on the client side render based on `action`.
 */
@Injectable()
export class TaskActivityService {
    constructor(private readonly prisma: PrismaService) {}

    public async log(
        client: PrismaService | Prisma.TransactionClient,
        taskId: bigint,
        actorId: number,
        action: TaskActivityAction,
        payload?: Record<string, unknown>,
    ): Promise<void> {
        await client.kanbanTaskActivity.create({
            data: {
                task_id: taskId,
                actor_id: actorId,
                action,
                payload: payload ? (payload as Prisma.InputJsonValue) : undefined,
                created_at: nowSec(),
            },
        });
    }
}
