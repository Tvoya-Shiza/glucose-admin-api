import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AudienceService } from '../audience/audience.service';
import type { ScopeActor } from '../../common/scoping/scope.types';
import type { AudienceShapeDto } from '../audience/dto/audience-preview.dto';
import { MailerService } from './services/mailer.service';
import { MailingSendDto } from './dto/mailings-send.dto';

/**
 * Phase 8 Plan 05 — MailingsSendService (PSH-05).
 *
 * Mirrors PushBroadcastService for the mailings surface. Differences:
 *   - SMTP throughput is much lower than FCM, so SMTP_CHUNK_SIZE = 50 (FCM uses 250).
 *   - exclude_no_email is FORCED to true server-side regardless of client input —
 *     mailings to users without an email address are nothing to send.
 *   - When MailerService.isConfigured() === false (typical dev / pre-prod), the
 *     service early-aborts WITHOUT writing any MailingLog rows. This avoids
 *     polluting history with thousands of 'no-smtp-config' error rows when an
 *     operator forgets the env vars.
 *   - HTML body is NOT sanitized in v1 (T-08-05-04). Admin is trusted; mail
 *     clients sanitize at render time.
 *
 * Cross-process idempotency (D-12, D-13 mirror, PSH-04 contract):
 *   attempt_id = sha256(broadcastId + ':' + userId), probe MailingLog before
 *   writing. Re-running the same broadcast_id produces zero new rows + a
 *   `duplicate_dedup_count` matching the audience size.
 *
 * Audit (D-17):
 *   The controller's `@Audit('mail.send', 'mailing_log')` captures broadcast_id +
 *   actor only — recipient list is NOT in the response shape (aggregate counts +
 *   audience_hash) so the audit interceptor cannot leak PII.
 */

const SMTP_CHUNK_SIZE = 50;

export interface MailingSendResult {
    broadcast_id: string;
    audience_count: number;
    delivered_count: number;
    failed_count: number;
    duplicate_dedup_count: number;
    started_at: number;
    completed_at: number;
    /** True when MailerService.isConfigured() === false at send time — no rows written. */
    smtp_unconfigured: boolean;
    audience_hash: string;
}

@Injectable()
export class MailingsSendService {
    private readonly logger = new Logger(MailingsSendService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly audience: AudienceService,
        private readonly mailer: MailerService,
    ) {}

    /**
     * D-14 + D-15 + PSH-04 mirror: full mailing send flow.
     *
     * Algorithm:
     *   1. broadcastId = input.broadcast_id ?? randomUUID()
     *   2. Inject exclude_no_email=true into audience (server-enforced).
     *   3. resolved = audience.resolve(audience, actor) — already RBAC-narrowed.
     *   4. If !mailer.isConfigured() → return smtp_unconfigured=true + zero counts.
     *   5. For each recipient (chunked at SMTP_CHUNK_SIZE):
     *      - attemptId = sha256(broadcastId + ':' + userId)
     *      - probe MailingLog.findFirst by user_id + meta.attempt_id → skip if exists
     *      - mailer.sendMail(recipient.email, subject, html, text)
     *      - mailingLog.create with success/error + meta
     *   6. Return aggregate counts + audience_hash.
     */
    public async send(input: MailingSendDto, actor: ScopeActor): Promise<MailingSendResult> {
        const startedAt = Math.floor(Date.now() / 1000);
        const broadcastId = input.broadcast_id ?? randomUUID();

        // Server-enforced: mailings always exclude users without an email address.
        // Defense-in-depth — DTO does not include exclude_no_email, but the audience
        // shape may carry exclude_no_email=false from an attacker; we override.
        const audience: AudienceShapeDto = {
            ...input.audience,
            exclude_no_email: true,
        } as AudienceShapeDto;

        const resolved = await this.audience.resolve(audience, actor);
        const audience_hash = resolved.audience_hash;

        // Early-abort when SMTP is unconfigured — write ZERO MailingLog rows.
        // Avoids polluting history with thousands of 'no-smtp-config' errors when
        // an operator forgets the env vars.
        if (!this.mailer.isConfigured()) {
            this.logger.warn(
                `mailings.send aborted: SMTP not configured (audience_count=${resolved.count}, ` +
                    `actor=${actor.id} broadcast_id=${broadcastId})`,
            );
            return {
                broadcast_id: broadcastId,
                audience_count: resolved.count,
                delivered_count: 0,
                failed_count: 0,
                duplicate_dedup_count: 0,
                started_at: startedAt,
                completed_at: Math.floor(Date.now() / 1000),
                smtp_unconfigured: true,
                audience_hash,
            };
        }

        let delivered = 0;
        let failed = 0;
        let duplicate = 0;

        for (let i = 0; i < resolved.recipients.length; i += SMTP_CHUNK_SIZE) {
            const chunk = resolved.recipients.slice(i, i + SMTP_CHUNK_SIZE);

            for (const recipient of chunk) {
                if (!recipient.email) {
                    // Defense-in-depth: exclude_no_email already filtered, but the
                    // resolver returns has_email/email; double-check.
                    continue;
                }

                const attemptId = this.deriveAttemptId(broadcastId, recipient.id);

                // Dedup-probe (D-12 mirror). Prisma JSON path filter on MySQL maps to JSON_EXTRACT.
                const existing = await this.prisma.mailingLog.findFirst({
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

                const result = await this.mailer.sendMail(
                    recipient.email,
                    input.subject,
                    input.html,
                    input.text,
                );

                try {
                    await this.prisma.mailingLog.create({
                        data: {
                            user_id: recipient.id,
                            sender_id: actor.id,
                            subject: input.subject,
                            to_email: recipient.email,
                            category: input.category,
                            success: result.success,
                            error: result.error ?? null,
                            meta: {
                                attempt_id: attemptId,
                                broadcast_id: broadcastId,
                                audience_hash,
                                smtp_message_id: result.messageId,
                            } as any,
                        },
                    });
                } catch (err) {
                    this.logger.warn(
                        `mailingLog.create failed user=${recipient.id} broadcast=${broadcastId}: ` +
                            `${(err as Error)?.message}`,
                    );
                }

                if (result.success) delivered++;
                else failed++;
            }
        }

        const completedAt = Math.floor(Date.now() / 1000);
        const sum = delivered + failed + duplicate;
        if (sum !== resolved.count) {
            this.logger.warn(
                `mailings.send count mismatch: expected ${resolved.count}, ` +
                    `got d=${delivered} f=${failed} dd=${duplicate}`,
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
            smtp_unconfigured: false,
            audience_hash,
        };
    }

    /**
     * Deterministic attempt_id derivation: sha256(broadcastId + ':' + userId).
     * Identical algorithm to PushBroadcastService.deriveAttemptId — both surfaces
     * use the same shape so future audit cross-references work uniformly.
     */
    private deriveAttemptId(broadcastId: string, userId: number): string {
        return createHash('sha256').update(`${broadcastId}:${userId}`).digest('hex');
    }
}
