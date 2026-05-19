import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma';
import type { AdminNotificationCategory } from '../../../generated/prisma';
import { PrismaService } from '../../prisma/prisma.service';
import { ListNotificationsDto } from './dto/list-notifications.dto';

/**
 * Generic in-app notifications feed for the admin panel.
 *
 * Phase 12 consumers (`task_assigned`, `task_due_soon`, ...) live in
 * `TaskEventNotifierService`. Future feature phases can hand any new
 * `category` value here without DDL.
 *
 * Self-notification suppression: when an actor performs an action that
 * notifies a list of users that includes themselves, the caller filters out
 * `actor.id` before passing to `createMany`. We do NOT enforce that in the
 * service so test fixtures and the cron job (where there is no actor) can
 * still notify everyone in the recipient list.
 */
@Injectable()
export class AdminNotificationsService {
    public static readonly DEFAULT_PAGE_SIZE = 50;

    constructor(private readonly prisma: PrismaService) {}

    public async list(actorId: number, query: ListNotificationsDto) {
        const page = Math.max(1, query.page ?? 1);
        const page_size = Math.min(200, Math.max(1, query.page_size ?? AdminNotificationsService.DEFAULT_PAGE_SIZE));

        const where: Prisma.AdminNotificationWhereInput = { user_id: actorId };
        if (query.unread_only) where.is_read = false;

        const [total, rows, unread] = await this.prisma.$transaction([
            this.prisma.adminNotification.count({ where }),
            this.prisma.adminNotification.findMany({
                where,
                orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
                skip: (page - 1) * page_size,
                take: page_size,
            }),
            this.prisma.adminNotification.count({ where: { user_id: actorId, is_read: false } }),
        ]);

        return {
            rows: rows.map((r) => ({
                id: String(r.id),
                user_id: r.user_id,
                category: r.category,
                payload: r.payload,
                is_read: r.is_read,
                read_at: r.read_at,
                created_at: r.created_at,
            })),
            total,
            page,
            page_size,
            unread_count: unread,
        };
    }

    public async unreadCount(actorId: number): Promise<{ unread_count: number }> {
        const unread = await this.prisma.adminNotification.count({
            where: { user_id: actorId, is_read: false },
        });
        return { unread_count: unread };
    }

    public async markRead(actorId: number, id: bigint): Promise<{ ok: true }> {
        const nowSec = Math.floor(Date.now() / 1000);
        await this.prisma.adminNotification.updateMany({
            where: { id, user_id: actorId, is_read: false },
            data: { is_read: true, read_at: nowSec },
        });
        return { ok: true };
    }

    public async markAllRead(actorId: number): Promise<{ ok: true; updated: number }> {
        const nowSec = Math.floor(Date.now() / 1000);
        const res = await this.prisma.adminNotification.updateMany({
            where: { user_id: actorId, is_read: false },
            data: { is_read: true, read_at: nowSec },
        });
        return { ok: true, updated: res.count };
    }

    public async createMany(
        recipientIds: number[],
        category: AdminNotificationCategory,
        payload: Record<string, unknown>,
    ): Promise<void> {
        if (recipientIds.length === 0) return;
        const nowSec = Math.floor(Date.now() / 1000);
        const data = recipientIds.map((user_id) => ({
            user_id,
            category,
            payload: payload as Prisma.InputJsonValue,
            created_at: nowSec,
        }));
        await this.prisma.adminNotification.createMany({ data });
    }
}
