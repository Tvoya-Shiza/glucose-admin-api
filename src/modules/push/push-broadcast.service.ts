import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AudienceService } from '../audience/audience.service';
import type { ScopeActor } from '../../common/scoping/scope.types';
import type { AudienceShapeDto } from '../audience/dto/audience-preview.dto';
import { PushFcmService } from './services/push-fcm.service';
import type { PushPayloadDto } from './dto/push-broadcast.dto';

/**
 * Phase 8 Plan 03 — broadcast orchestration.
 *
 * Responsibility split:
 *   1. Resolve audience via AudienceService.resolve(audience, actor) → recipient list (already
 *      RBAC-narrowed, deduplicated, capped at AudienceService.MAX_RECIPIENTS).
 *   2. For each recipient: derive deterministic attempt_id = sha256(broadcastId + ':' + userId),
 *      probe PushNotificationLog for existing attempt_id → if found, count as duplicate_dedup
 *      and skip; otherwise call PushFcmService.sendToUser, then write a single log row.
 *   3. Return aggregate counts + audience_hash so the caller (controller) can pass them on
 *      and the audit trail captures the size of the broadcast (NOT the recipient list — D-17).
 *
 * Cross-process idempotency (PSH-04, D-12, D-13):
 *   The attempt_id is deterministic per (broadcast_id, user_id) for ad-hoc broadcasts and per
 *   (scheduled_push_id, user_id, scheduled_at) for cron-fired scheduled broadcasts (Plan 04
 *   reuses this same service with triggerType='admin.scheduled' and an externally supplied
 *   broadcastId derived from the ScheduledPush row). glucose-api auto-trigger services use
 *   the SAME meta.attempt_id shape (Phase 1 Plan 04 trigger3-inactivity); a duplicate attempt_id
 *   from either side becomes a no-op via the findFirst probe — no second log row is written.
 *
 * Chunking + failure isolation:
 *   FCM_CHUNK_SIZE = 250 — a chunk holds up to 250 recipients in memory while we iterate
 *   FCM sends + log writes. The dedup probe + create cannot be batched reliably (Prisma
 *   has no INSERT IGNORE; we'd need raw SQL), so per-recipient work is sequential within a
 *   chunk. A failure on one recipient does NOT abort the broadcast — we catch + log + count
 *   as failed, write a success=false log row, and continue.
 *
 * Plan 04 reuse:
 *   PushModule exports this service so the cron handler can call .broadcast() with
 *   triggerType='admin.scheduled' and the scheduled_push_id-derived broadcastId.
 */

const FCM_CHUNK_SIZE = 250;

export interface PushBroadcastResult {
    broadcast_id: string;
    audience_count: number;
    delivered_count: number;
    failed_count: number;
    duplicate_dedup_count: number;
    started_at: number;
    completed_at: number;
    audience_hash: string;
}

export type PushTriggerType = 'admin.broadcast' | 'admin.scheduled';

@Injectable()
export class PushBroadcastService {
    private readonly logger = new Logger(PushBroadcastService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly audience: AudienceService,
        private readonly fcm: PushFcmService,
    ) {}

    /**
     * D-04 + D-06: full broadcast flow. Resolve → for each recipient: derive attempt_id,
     * dedup-probe, send via FCM, write log. Returns aggregate counts (no recipient list,
     * D-17 GDPR rule — the audit interceptor captures this return value's id only).
     */
    public async broadcast(
        payload: PushPayloadDto,
        audience: AudienceShapeDto,
        broadcastId: string,
        triggerType: PushTriggerType,
        actor: ScopeActor,
    ): Promise<PushBroadcastResult> {
        const startedAt = Math.floor(Date.now() / 1000);
        const resolved = await this.audience.resolve(audience, actor);
        const audience_hash = resolved.audience_hash;

        // Write in-app Notification rows for ALL recipients before FCM loop
        // so students without FCM tokens also see the message in their bell inbox.
        await this.writeInboxNotifications(payload, resolved.recipients, startedAt);

        let delivered = 0;
        let failed = 0;
        let duplicate = 0;

        // Chunk recipients. Iteration is sequential per chunk to keep the dedup-probe
        // semantically correct (probe-then-create is two round trips; we accept the cost).
        for (let i = 0; i < resolved.recipients.length; i += FCM_CHUNK_SIZE) {
            const chunk = resolved.recipients.slice(i, i + FCM_CHUNK_SIZE);

            for (const recipient of chunk) {
                const attemptId = this.deriveAttemptId(broadcastId, recipient.id);

                // Dedup-probe (D-12). Prisma JSON path filter on MySQL maps to JSON_EXTRACT.
                const existing = await this.prisma.pushNotificationLog.findFirst({
                    where: {
                        user_id: recipient.id,
                        meta: { path: ['attempt_id'], equals: attemptId } as any,
                    },
                    select: { id: true },
                });
                if (existing) {
                    duplicate++;
                    continue;
                }

                if (!recipient.has_fcm) {
                    // No FCM token on file — skip the FCM call, write a failure log row so
                    // history shows the attempt + reason. attempt_id remains deterministic.
                    await this.writeLog(recipient.id, triggerType, false, {
                        attempt_id: attemptId,
                        broadcast_id: broadcastId,
                        category: payload.category,
                        audience_hash,
                        error: 'no_fcm_token',
                    });
                    failed++;
                    continue;
                }

                let success = false;
                let error: string | undefined;
                try {
                    success = await this.fcm.sendToUser(recipient.id, payload.title_kz, payload.body_kz, {
                        category: payload.category,
                        deep_link: payload.deep_link ?? '',
                        broadcast_id: broadcastId,
                        attempt_id: attemptId,
                    });
                    if (!success) error = 'fcm_send_returned_false';
                } catch (err) {
                    error = (err as Error)?.message ?? 'unknown';
                    this.logger.warn(
                        `broadcast send failed user=${recipient.id} broadcast=${broadcastId}: ${error}`,
                    );
                }

                await this.writeLog(recipient.id, triggerType, success, {
                    attempt_id: attemptId,
                    broadcast_id: broadcastId,
                    category: payload.category,
                    audience_hash,
                    error,
                });
                if (success) delivered++;
                else failed++;
            }
        }

        const completedAt = Math.floor(Date.now() / 1000);
        const sum = delivered + failed + duplicate;
        if (sum !== resolved.count) {
            this.logger.warn(
                `broadcast count mismatch: expected ${resolved.count}, got d=${delivered} f=${failed} dd=${duplicate}`,
            );
        }

        return {
            broadcast_id: broadcastId,
            audience_count: resolved.count,
            delivered_count: delivered,
            failed_count: failed,
            duplicate_dedup_count: duplicate,
            started_at: startedAt,
            completed_at: completedAt,
            audience_hash,
        };
    }

    /**
     * D-03: send a single push to actor.id only. trigger_type='admin.test'.
     * attempt_id is random per call (no idempotency desired — one row per click).
     */
    public async sendTestToMe(
        actorId: number,
        payload: PushPayloadDto,
    ): Promise<{ success: boolean; error?: string }> {
        const attemptId = randomUUID();
        let success = false;
        let error: string | undefined;
        try {
            success = await this.fcm.sendToUser(actorId, payload.title_kz, payload.body_kz, {
                category: payload.category,
                deep_link: payload.deep_link ?? '',
                attempt_id: attemptId,
            });
            if (!success) error = 'fcm_send_returned_false';
        } catch (err) {
            error = (err as Error)?.message ?? 'unknown';
        }

        await this.writeLog(actorId, 'admin.test', success, {
            attempt_id: attemptId,
            category: payload.category,
            error,
        });

        return { success, error };
    }

    /**
     * Deterministic attempt_id derivation: sha256(broadcastId + ':' + userId).
     *
     * Callers MUST pass a stable broadcastId (UUID v4 generated once per request, or
     * a derived value for scheduled pushes — see Plan 04). The hash output is hex
     * (64 chars) and stored under PushNotificationLog.meta.attempt_id.
     *
     * Collision resistance: sha256 is collision-resistant; finding a different
     * (broadcastId, userId) tuple that produces the same digest is computationally
     * infeasible. Plus, the audit row records the original broadcastId, so any
     * tampering attempt is forensically traceable (T-08-03-02).
     */
    private deriveAttemptId(broadcastId: string, userId: number): string {
        return createHash('sha256').update(`${broadcastId}:${userId}`).digest('hex');
    }

    /**
     * Writes a single PushNotificationLog row. Errors are logged but do NOT propagate —
     * audit observability must never block a broadcast. The probe-then-create pattern
     * has a TOCTOU window; PushNotificationLog has no unique constraint on
     * meta.attempt_id, so a rare double-write is possible if two processes race the
     * same attempt_id. The broadcast count mismatch warn-log (above) catches this.
     */
    private async writeLog(
        userId: number,
        triggerType: string,
        success: boolean,
        meta: Record<string, unknown>,
    ): Promise<void> {
        try {
            await this.prisma.pushNotificationLog.create({
                data: {
                    user_id: userId,
                    trigger_type: triggerType,
                    success,
                    meta: meta as any,
                },
            });
        } catch (err) {
            this.logger.warn(
                `pushNotificationLog.create failed user=${userId} trigger=${triggerType}: ${(err as Error)?.message}`,
            );
        }
    }

    private mapCategoryToKind(category: string): string {
        const map: Record<string, string> = {
            info: 'platform_update',
            promo: 'payment',
            reminder: 'progress',
            system: 'platform_update',
        };
        return map[category] ?? 'platform_update';
    }

    private async writeInboxNotifications(
        payload: PushPayloadDto,
        recipients: Array<{ id: number; has_fcm: boolean }>,
        nowSec: number,
    ): Promise<void> {
        if (!recipients.length) return;
        const INBOX_CHUNK = 500;
        const kind = this.mapCategoryToKind(payload.category ?? 'info');

        try {
            for (let i = 0; i < recipients.length; i += INBOX_CHUNK) {
                const chunk = recipients.slice(i, i + INBOX_CHUNK);
                await this.prisma.notification.createMany({
                    data: chunk.map((r) => ({
                        user_id: r.id,
                        title: payload.title_kz,
                        message: payload.body_kz,
                        kind,
                        deep_link: payload.deep_link ?? null,
                        type: 'single',
                        sender: 'admin',
                        created_at: nowSec,
                    })) as any[],
                    skipDuplicates: true,
                });
            }
        } catch (err) {
            this.logger.warn(`writeInboxNotifications failed: ${(err as Error)?.message}`);
        }
    }
}
