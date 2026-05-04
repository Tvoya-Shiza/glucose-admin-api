import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { AudienceService } from '../audience/audience.service';
import type { PushScheduleDto, PushScheduledListQueryDto } from './dto/push-schedule.dto';
import { PushCacheService } from './utils/push-cache.service';
import { PUSH_INVALIDATE_PATTERN, PUSH_SCHEDULED_PREFIX } from './utils/push-cache';

/**
 * Phase 8 Plan 04 — schedule queue management (PSH-02).
 *
 * Responsibilities (D-07, D-08, D-09):
 *   1. schedule(input, actor) — validate scheduled_at > now+30s, snapshot audience JSON
 *      onto the row, write `scheduled_pushes` row with status='pending'. Cron picks it up.
 *   2. list(query, actor) — admin-only paginated queue view; 60s Redis cache.
 *   3. cancel(id, actor) — atomic transition pending → cancelled (updateMany count guard).
 *      Returns 404 if missing, 409 if already in_progress/completed/cancelled/failed.
 *
 * RBAC (D-19): every method requires admin. Curator + teacher are blocked at the
 * controller level by @Roles('admin'); the service mirrors the check belt-and-braces
 * so a future controller-less caller (e.g. a test) cannot escalate.
 *
 * Audience JSON is stored as-is. Cron re-runs AudienceService.resolve() at fire-time
 * so RBAC narrowing happens against the CURRENT user/group state — not a stale snapshot.
 * This trades reproducibility for accuracy; in v1 we err toward accuracy because
 * the broadcast itself is the side-effect we care about, not the audit trail of
 * "what would have shipped at the time admin clicked schedule".
 */
@Injectable()
export class PushScheduleService {
    private readonly logger = new Logger(PushScheduleService.name);

    /** Buffer to absorb clock skew + scheduling latency. 30s is generous; cron runs every 60s. */
    private static readonly SCHEDULE_AT_FUTURE_BUFFER_S = 30;

    constructor(
        private readonly prisma: PrismaService,
        private readonly cache: PushCacheService,
        private readonly audience: AudienceService,
    ) {}

    /** D-07: write a pending ScheduledPush row. */
    public async schedule(input: PushScheduleDto, actor: ScopeActor) {
        this.requireAdmin(actor, 'schedule.create.admin_only');

        const nowSec = Math.floor(Date.now() / 1000);
        if (input.scheduled_at <= nowSec + PushScheduleService.SCHEDULE_AT_FUTURE_BUFFER_S) {
            throw new BadRequestException('schedule.scheduled_at_in_past');
        }

        // Pre-compute audience preview so we can persist audience_count up-front
        // (replaces the 0 default; cron may overwrite at fire-time with the
        // actual resolved count). This also acts as a cheap validation that the
        // audience shape resolves correctly under the actor's RBAC scope.
        const preview = await this.audience.preview(input.audience, actor);

        const created = await this.prisma.scheduledPush.create({
            data: {
                creator_id: actor.id,
                title_ru: input.payload.title_ru,
                title_kz: input.payload.title_kz,
                body_ru: input.payload.body_ru,
                body_kz: input.payload.body_kz,
                category: input.payload.category,
                deep_link: input.payload.deep_link ?? null,
                audience: input.audience as any,
                scheduled_at: input.scheduled_at,
                status: 'pending',
                audience_count: preview.count,
                created_at: nowSec,
                updated_at: nowSec,
            },
            include: { creator: { select: { full_name: true } } },
        });

        await this.cache.invalidate(PUSH_INVALIDATE_PATTERN);
        return this.mapDetail(created, preview.audience_hash);
    }

    /** D-08: admin-only paginated list of scheduled pushes. */
    public async list(query: PushScheduledListQueryDto, actor: ScopeActor) {
        this.requireAdmin(actor, 'schedule.list.admin_only');

        const page = Math.max(1, query.page ?? 1);
        const pageSize = Math.min(100, Math.max(1, query.page_size ?? 25));
        const sort = query.sort ?? 'scheduled_at';
        const order: 'asc' | 'desc' = query.order ?? 'desc';

        const where: Record<string, any> = {};
        if (query.status) where.status = query.status;
        if (query.creator_id) where.creator_id = query.creator_id;

        const cacheKey =
            `${PUSH_SCHEDULED_PREFIX}:${actor.role_name}:${actor.id}:p${page}:s${pageSize}:` +
            `${sort}:${order}:${JSON.stringify(where)}`;

        return this.cache.getOrSet(cacheKey, async () => {
            const [rows, total] = await Promise.all([
                this.prisma.scheduledPush.findMany({
                    where: where as any,
                    orderBy: { [sort]: order },
                    skip: (page - 1) * pageSize,
                    take: pageSize,
                    include: { creator: { select: { full_name: true } } },
                }),
                this.prisma.scheduledPush.count({ where: where as any }),
            ]);

            return {
                rows: rows.map((r) => this.mapRow(r)),
                total,
                pageCount: Math.max(1, Math.ceil(total / pageSize)),
                page,
                page_size: pageSize,
            };
        });
    }

    /**
     * Atomic transition pending → cancelled.
     * - 404 if the row does not exist.
     * - 409 if the row exists but is in any other status (cron has claimed it,
     *   or it already completed/failed/was cancelled).
     */
    public async cancel(id: bigint, actor: ScopeActor) {
        this.requireAdmin(actor, 'schedule.cancel.admin_only');

        const nowSec = Math.floor(Date.now() / 1000);
        const result = await this.prisma.scheduledPush.updateMany({
            where: { id, status: 'pending' },
            data: {
                status: 'cancelled',
                cancelled_at: nowSec,
                cancelled_by: actor.id,
                updated_at: nowSec,
            },
        });

        if (result.count !== 1) {
            const existing = await this.prisma.scheduledPush.findUnique({ where: { id } });
            if (!existing) throw new NotFoundException('schedule.cancel.not_found');
            // Differentiate "already terminal" from "racing with cron" — both surface as 409.
            throw new ConflictException(`schedule.cancel.bad_status:${existing.status}`);
        }

        await this.cache.invalidate(PUSH_INVALIDATE_PATTERN);
        const updated = await this.prisma.scheduledPush.findUniqueOrThrow({
            where: { id },
            include: { creator: { select: { full_name: true } } },
        });
        // audience_hash is derivable from the snapshot but expensive to recompute here;
        // the cancel response surfaces an empty string. The schedule-list endpoint is
        // authoritative when consumers need the hash.
        return this.mapDetail(updated, '');
    }

    private requireAdmin(actor: ScopeActor, key: string): void {
        if (actor.role_name !== 'admin') {
            throw new ForbiddenException(key);
        }
    }

    private mapRow(r: any) {
        return {
            id: r.id.toString(),
            title_ru: r.title_ru,
            title_kz: r.title_kz,
            category: r.category,
            scheduled_at: r.scheduled_at,
            status: r.status,
            audience_count: r.audience_count,
            delivered_count: r.delivered_count,
            failed_count: r.failed_count,
            creator_id: r.creator_id,
            creator_full_name: r.creator?.full_name ?? null,
            created_at: r.created_at,
            cancelled_at: r.cancelled_at ?? null,
            error: r.error ?? null,
        };
    }

    private mapDetail(r: any, audience_hash: string) {
        return {
            ...this.mapRow(r),
            body_ru: r.body_ru,
            body_kz: r.body_kz,
            deep_link: r.deep_link,
            audience: r.audience,
            started_at: r.started_at ?? null,
            completed_at: r.completed_at ?? null,
            audience_hash,
        };
    }
}
