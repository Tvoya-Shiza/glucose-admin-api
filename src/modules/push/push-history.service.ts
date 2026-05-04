import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { buildScopeWhere } from '../../common/scoping/scope.helper';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { PushHistoryQueryDto } from './dto/push-history.dto';
import { PUSH_HISTORY_PREFIX } from './utils/push-cache';
import { PushCacheService } from './utils/push-cache.service';
import { PUSH_SCOPE_RULES } from './push.scope';

/**
 * Phase 8 Plan 03 — push history list service (PSH-03, D-11).
 *
 * Returns paginated PushNotificationLog rows with per-actor RBAC scoping:
 *   - admin   → no narrowing (sees all rows)
 *   - curator → user.group_users.some.group.supervisor_id = actor.id
 *   - teacher → user.sales_as_buyer.some.webinar.teacher_id = actor.id
 *
 * The scoping fragment lives in push.scope.ts (Plan 01); this service spreads
 * it into the Prisma `where` clause via buildScopeWhere(). That helper returns
 * `{}` for admin (no narrowing) and `{ id: { in: [] } }` for unknown roles
 * (default-deny — students would see zero rows, never accidentally widen).
 *
 * Cache: 60s under geonline-admin:push:history:<actor-namespace>:<filter-shape>
 * (D-18). Actor identity is part of the cache key so curator-narrowed pages
 * cannot bleed into admin pages when the same filter shape is requested.
 */
@Injectable()
export class PushHistoryService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly cache: PushCacheService,
    ) {}

    public async list(query: PushHistoryQueryDto, actor: ScopeActor) {
        const page = Math.max(1, query.page ?? 1);
        const pageSize = Math.min(100, Math.max(1, query.page_size ?? 25));
        const sort = query.sort ?? 'sent_at';
        const order: 'asc' | 'desc' = query.order ?? 'desc';

        const filters: Record<string, any> = {};
        if (query.user_id) filters.user_id = query.user_id;
        if (query.trigger_type) filters.trigger_type = query.trigger_type;
        if (typeof query.success === 'boolean') filters.success = query.success;
        if (query.date_from || query.date_to) {
            filters.sent_at = {} as Record<string, Date>;
            if (query.date_from) filters.sent_at.gte = new Date(query.date_from * 1000);
            if (query.date_to) filters.sent_at.lte = new Date(query.date_to * 1000);
        }

        const scopeWhere = buildScopeWhere(actor, PUSH_SCOPE_RULES);
        const where: Record<string, any> = { ...filters, ...scopeWhere };

        const cacheKey =
            `${PUSH_HISTORY_PREFIX}:${actor.role_name}:${actor.id}:p${page}:s${pageSize}:` +
            `${sort}:${order}:${JSON.stringify(filters)}`;

        return this.cache.getOrSet(cacheKey, async () => {
            const [rows, total] = await Promise.all([
                this.prisma.pushNotificationLog.findMany({
                    where: where as any,
                    orderBy: { [sort]: order },
                    skip: (page - 1) * pageSize,
                    take: pageSize,
                    select: {
                        id: true,
                        user_id: true,
                        trigger_type: true,
                        sent_at: true,
                        success: true,
                        meta: true,
                        user: { select: { full_name: true, email: true } },
                    },
                }),
                this.prisma.pushNotificationLog.count({ where: where as any }),
            ]);

            return {
                rows: rows.map((r) => ({
                    // BigInt-as-string per admin-api convention.
                    id: r.id.toString(),
                    user_id: r.user_id,
                    user_full_name: r.user?.full_name ?? null,
                    user_email: r.user?.email ?? null,
                    trigger_type: r.trigger_type,
                    // sent_at is stored as Timestamp(0); admin-client expects Unix seconds.
                    sent_at: Math.floor(r.sent_at.getTime() / 1000),
                    success: r.success,
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
