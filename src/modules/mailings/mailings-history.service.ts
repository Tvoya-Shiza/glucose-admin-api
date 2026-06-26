import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { MailingsHistoryQueryDto } from './dto/mailings-history.dto';
import { MAILINGS_HISTORY_PREFIX } from './utils/mailings-cache';
import { MailingsCacheService } from './utils/mailings-cache.service';

/**
 * Phase 8 Plan 05 — mailings history list service (PSH-06, D-16).
 *
 * Returns paginated MailingLog rows.
 *
 * RBAC (D-19): runtime-driven via @RequirePermission('mailings.history_view')
 * on the controller. Any admitted role with the grant may view history.
 *
 * Cache: 60s under geonline-admin:mailings:history:<actor.id>:<filter-shape>
 * (D-18). Short TTL means newly-sent mailings surface quickly; pagination
 * clicks coalesce within the window.
 */
@Injectable()
export class MailingsHistoryService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly cache: MailingsCacheService,
    ) {}

    public async list(query: MailingsHistoryQueryDto, actor: ScopeActor) {
        const page = Math.max(1, query.page ?? 1);
        const pageSize = Math.min(100, Math.max(1, query.page_size ?? 25));
        const sort = query.sort ?? 'sent_at';
        const order: 'asc' | 'desc' = query.order ?? 'desc';

        const filters: Record<string, any> = {};
        if (query.user_id) filters.user_id = query.user_id;
        if (query.subject) filters.subject = { contains: query.subject };
        if (typeof query.success === 'boolean') filters.success = query.success;
        if (query.category) filters.category = query.category;
        if (query.date_from || query.date_to) {
            filters.sent_at = {} as Record<string, Date>;
            if (query.date_from) filters.sent_at.gte = new Date(query.date_from * 1000);
            if (query.date_to) filters.sent_at.lte = new Date(query.date_to * 1000);
        }

        const cacheKey =
            `${MAILINGS_HISTORY_PREFIX}:${actor.role_name}:${actor.id}:p${page}:s${pageSize}:` +
            `${sort}:${order}:${JSON.stringify(filters)}`;

        return this.cache.getOrSet(cacheKey, async () => {
            const [rows, total] = await Promise.all([
                this.prisma.mailingLog.findMany({
                    where: filters as any,
                    orderBy: { [sort]: order },
                    skip: (page - 1) * pageSize,
                    take: pageSize,
                    select: {
                        id: true,
                        user_id: true,
                        sender_id: true,
                        subject: true,
                        to_email: true,
                        category: true,
                        sent_at: true,
                        success: true,
                        error: true,
                        meta: true,
                        user: { select: { full_name: true } },
                        sender: { select: { full_name: true } },
                    },
                }),
                this.prisma.mailingLog.count({ where: filters as any }),
            ]);

            return {
                rows: rows.map((r) => ({
                    // BigInt-as-string per admin-api convention.
                    id: r.id.toString(),
                    user_id: r.user_id,
                    user_full_name: r.user?.full_name ?? null,
                    sender_id: r.sender_id ?? null,
                    sender_full_name: r.sender?.full_name ?? null,
                    subject: r.subject,
                    to_email: r.to_email,
                    category: r.category,
                    // sent_at is stored as Timestamp(0); admin-client expects Unix seconds.
                    sent_at: Math.floor(r.sent_at.getTime() / 1000),
                    success: r.success,
                    error: r.error ?? null,
                    meta: (r.meta ?? null) as any,
                })),
                total,
                pageCount: Math.max(1, Math.ceil(total / pageSize)),
                page,
                page_size: pageSize,
            };
        });
    }
}
