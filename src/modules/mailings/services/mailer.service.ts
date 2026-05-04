import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';

export interface MailSendResult {
    success: boolean;
    messageId?: string;
    error?: string;
}

/**
 * Phase 8 Plan 01 — SMTP wrapper for admin mailings (PSH-05, PSH-06).
 *
 * Reads SMTP_* env vars at boot. When SMTP_HOST is blank (dev / not yet
 * configured), sendMail returns {success:false, error:'no-smtp-config'}
 * without throwing — same no-op contract as PushFcmService when
 * FIREBASE_* is missing. Plan 05 broadcast service relies on this
 * contract to keep the audit + history-write path running cleanly.
 *
 * Why direct nodemailer (not @nestjs-modules/mailer)?
 *   The Nest module supports templates we don't need yet (DEFERRED:
 *   templating with Handlebars). nodemailer.createTransport gives us
 *   the same SMTP support with zero template overhead. We keep
 *   @nestjs-modules/mailer in package.json because the dep was already
 *   declared in glucose-api and Phase 9+ may opt in to its templating.
 */
@Injectable()
export class MailerService implements OnModuleInit {
    private readonly logger = new Logger(MailerService.name);
    private transporter: Transporter | null = null;
    private from = '';

    constructor(private readonly config: ConfigService) {}

    onModuleInit(): void {
        const host = this.config.get<string>('SMTP_HOST');
        const port = parseInt(this.config.get<string>('SMTP_PORT') ?? '587', 10);
        const user = this.config.get<string>('SMTP_USER');
        const pass = this.config.get<string>('SMTP_PASSWORD');
        const secure = (this.config.get<string>('SMTP_SECURE') ?? 'false') === 'true';
        this.from = this.config.get<string>('SMTP_FROM') ?? '';

        if (!host) {
            this.logger.warn('[MailerService] SMTP_HOST not set — sendMail will no-op until configured');
            return;
        }
        if (!this.from) {
            this.logger.warn('[MailerService] SMTP_FROM not set — sendMail will no-op until configured');
            return;
        }

        this.transporter = createTransport({
            host,
            port,
            secure,
            auth: user && pass ? { user, pass } : undefined,
        });
    }

    /**
     * Returns true when SMTP transport is configured and ready to send.
     * Plan 05 uses this to short-circuit broadcasts with smtp_unconfigured=true.
     */
    isConfigured(): boolean {
        return this.transporter !== null;
    }

    /**
     * Send a single transactional email.
     * @param to recipient email — caller MUST validate before calling
     * @param subject plain-text subject — caller MUST escape any user input
     * @param html sanitized HTML body — caller is responsible for sanitization
     * @param text optional plain-text fallback (defaults to a stripped HTML)
     */
    async sendMail(to: string, subject: string, html: string, text?: string): Promise<MailSendResult> {
        if (!this.transporter) {
            return { success: false, error: 'no-smtp-config' };
        }
        try {
            const info = await this.transporter.sendMail({
                from: this.from,
                to,
                subject,
                html,
                text: text ?? html.replace(/<[^>]+>/g, ''),
            });
            return { success: true, messageId: info.messageId };
        } catch (err) {
            const msg = (err as Error)?.message ?? 'unknown';
            this.logger.warn(`[MailerService] sendMail failed to=${to}: ${msg}`);
            return { success: false, error: msg };
        }
    }
}
