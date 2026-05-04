import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { CronLock, CronLockService } from '../../common/decorators/cron-lock.decorator';
import type { ScopeActor } from '../../common/scoping/scope.types';
import type { RoleName } from '@shared/roles';
import { PushBroadcastService } from './push-broadcast.service';

/**
 * Phase 8 Plan 04 — minute-wise scheduled-push fire cron (PSH-02, D-09, D-10).
 *
 * Lifecycle of a ScheduledPush row driven by this service:
 *
 *     pending  --(cron tick + atomic claim)-->  in_progress
 *     in_progress --(broadcast success)-->     completed
 *     in_progress --(broadcast threw)-->       failed
 *     pending  --(cancel endpoint)-->          cancelled    (handled by PushScheduleService.cancel)
 *
 * Race-safety has THREE layers (D-10):
 *   1. @CronLock('admin-push-scheduled', 120_000) — across PM2 cluster, only one
 *      instance acquires the Redis lock per minute; the others observe and skip.
 *   2. Atomic status transition via prisma.scheduledPush.updateMany WHERE status='pending':
 *      the database returns count===1 only for the winning writer. If two instances
 *      did somehow race past layer 1 (e.g. Redis flapped + lock fail-open), one
 *      observes count===0 and bails BEFORE invoking the broadcast.
 *   3. Deterministic broadcast_id = sha256(scheduled_push_id) means even if both
 *      layers fail and two instances both call PushBroadcastService.broadcast(),
 *      the per-recipient attempt_id (sha256(broadcast_id + ':' + user_id)) is
 *      identical across both calls. PushBroadcastService.broadcast then dedup-probes
 *      PushNotificationLog by attempt_id and skips the second write — the worst
 *      case is two FCM calls (the user device dedupes its own notifications) and
 *      one log row.
 *
 * Per-row failure isolation: a try/catch around fireOne() lets one bad row not
 * block the rest of the tick. TICK_LOAD_LIMIT=50 caps memory pressure and
 * provides a natural backlog-drain rate of 50 rows/min = 3000/hour.
 */
const TICK_LOAD_LIMIT = 50;

@Injectable()
export class PushCronService {
    private readonly logger = new Logger(PushCronService.name);

    constructor(
        // public readonly — required name and visibility for the @CronLock decorator
        // (the decorator reads `this.cronLock` off the host class without reflection).
        public readonly cronLock: CronLockService,
        private readonly prisma: PrismaService,
        private readonly broadcastSvc: PushBroadcastService,
    ) {}

    /**
     * Tick handler. Runs every minute on every PM2 instance; @CronLock keeps only
     * one execution alive per tick. TTL of 120_000ms = 2x the cron interval per
     * the @CronLock convention (a tick taking longer than 2 minutes will overlap
     * with the next; the atomic claim + dedup probe keep that safe).
     */
    @Cron(CronExpression.EVERY_MINUTE)
    @CronLock('admin-push-scheduled', 120_000)
    public async fireDuePushes(): Promise<void> {
        const nowSec = Math.floor(Date.now() / 1000);
        const due = await this.prisma.scheduledPush.findMany({
            where: { status: 'pending', scheduled_at: { lte: nowSec } },
            orderBy: { scheduled_at: 'asc' },
            take: TICK_LOAD_LIMIT,
            select: { id: true },
        });
        if (due.length === 0) return;

        this.logger.log(`fireDuePushes: found ${due.length} due rows`);
        for (const row of due) {
            try {
                await this.fireOne(row.id);
            } catch (err) {
                // fireOne already catches broadcast errors and writes status='failed';
                // anything that escapes is a Prisma / lock / system error. Log and continue
                // so the rest of the tick still drains.
                this.logger.warn(
                    `fireOne failed id=${row.id.toString()}: ${(err as Error)?.message ?? 'unknown'}`,
                );
            }
        }
    }

    /**
     * Process a single ScheduledPush row.
     * Atomic claim → re-fetch full row → broadcast → write back terminal state.
     */
    private async fireOne(scheduledPushId: bigint): Promise<void> {
        const claimAt = Math.floor(Date.now() / 1000);

        // Layer-2 race guard: only the writer that flips pending→in_progress proceeds.
        const claim = await this.prisma.scheduledPush.updateMany({
            where: { id: scheduledPushId, status: 'pending' },
            data: { status: 'in_progress', started_at: claimAt, updated_at: claimAt },
        });
        if (claim.count !== 1) {
            // Either another instance won, or the row was cancelled between the
            // findMany and updateMany. Either way: no work to do.
            return;
        }

        // Re-fetch the full row — the broadcast call needs payload + audience + creator.
        const row = await this.prisma.scheduledPush.findUniqueOrThrow({
            where: { id: scheduledPushId },
            include: { creator: { select: { id: true, role_name: true } } },
        });
        const broadcastId = this.scheduledBroadcastId(scheduledPushId);

        // Use the schedule's CREATOR as the broadcast actor — RBAC narrowing
        // applied at AudienceService.resolve() reflects the creator's scope.
        // v1 only allows admin to schedule (Plan 04 Task 1), but this is
        // future-proof if a curator-schedule flow lands later.
        const actor: ScopeActor = {
            id: row.creator.id,
            role_name: (row.creator.role_name as RoleName) ?? 'admin',
        };

        try {
            const result = await this.broadcastSvc.broadcast(
                {
                    title_ru: row.title_ru,
                    title_kz: row.title_kz,
                    body_ru: row.body_ru,
                    body_kz: row.body_kz,
                    category: row.category as any,
                    deep_link: row.deep_link ?? undefined,
                },
                row.audience as any,
                broadcastId,
                'admin.scheduled',
                actor,
            );

            const completedAt = Math.floor(Date.now() / 1000);
            await this.prisma.scheduledPush.update({
                where: { id: scheduledPushId },
                data: {
                    status: 'completed',
                    completed_at: completedAt,
                    audience_count: result.audience_count,
                    delivered_count: result.delivered_count,
                    failed_count: result.failed_count,
                    updated_at: completedAt,
                },
            });
            this.logger.log(
                `fireOne completed id=${scheduledPushId.toString()} audience=${result.audience_count} ` +
                    `delivered=${result.delivered_count} failed=${result.failed_count} ` +
                    `dedup=${result.duplicate_dedup_count}`,
            );
        } catch (err) {
            const msg = (err as Error)?.message ?? 'unknown';
            this.logger.error(
                `broadcast threw for scheduled_push_id=${scheduledPushId.toString()}: ${msg}`,
            );
            const completedAt = Math.floor(Date.now() / 1000);
            await this.prisma.scheduledPush.update({
                where: { id: scheduledPushId },
                data: {
                    status: 'failed',
                    completed_at: completedAt,
                    // Schema column is Text but truncate to keep audit logs and table
                    // dumps tidy.
                    error: msg.slice(0, 500),
                    updated_at: completedAt,
                },
            });
        }
    }

    /**
     * Deterministic broadcast_id derived ONLY from the scheduled_push_id.
     *
     * Why deterministic: PushBroadcastService computes per-recipient
     * attempt_id = sha256(broadcast_id + ':' + user_id). If a re-fire happens
     * (lock TTL exceeded; two instances claim and broadcast for the same row
     * before layer-2 fires), the second broadcast computes IDENTICAL attempt_ids,
     * and the dedup probe in PushBroadcastService.broadcast skips the second log
     * row write. This is layer-3 of the exactly-once contract (D-10).
     *
     * The `sched:` prefix scopes the namespace so admin-broadcast UUIDs and
     * scheduled-push hashes cannot accidentally collide.
     *
     * The slice(0,32) keeps the broadcast_id under FCM's data-payload size budget
     * (4KB total per FCM message; broadcast_id appears in the data envelope).
     */
    private scheduledBroadcastId(id: bigint): string {
        return 'sched:' + createHash('sha256').update(id.toString()).digest('hex').slice(0, 32);
    }
}
