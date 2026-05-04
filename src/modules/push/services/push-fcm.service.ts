/**
 * Phase 8 Plan 01 — admin-side FCM client.
 *
 * Vendored from glucose-api/src/modules/auto-push-notifications/push-fcm.service.ts
 * (canonical implementation already running in pre-prod). Kept in sync manually —
 * if the upstream service gains methods, mirror them here. Both services read
 * UserFirebaseSession.fcm_token from the same MySQL row, so behavior is identical.
 *
 * onModuleInit guard: if FIREBASE_* env vars are missing, log warning and no-op.
 * sendToToken/sendToUser then return {success:false, shouldDelete:false} so the
 * caller's audit + log path still runs cleanly — the broadcast service in Plan 03
 * relies on this contract.
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { PrismaService } from 'src/prisma/prisma.service';

export interface FcmSendResult {
    success: boolean;
    shouldDelete: boolean;
}

const INVALID_TOKEN_CODES = new Set([
    'messaging/invalid-registration-token',
    'messaging/registration-token-not-registered',
    'messaging/invalid-argument',
]);

@Injectable()
export class PushFcmService implements OnModuleInit {
    private readonly logger = new Logger(PushFcmService.name);
    private app: admin.app.App | null = null;

    constructor(
        private readonly config: ConfigService,
        private readonly prisma: PrismaService,
    ) {}

    onModuleInit(): void {
        const projectId = this.config.get<string>('FIREBASE_PROJECT_ID');
        const clientEmail = this.config.get<string>('FIREBASE_CLIENT_EMAIL');
        const privateKey = this.config.get<string>('FIREBASE_PRIVATE_KEY')?.replace(/\\n/g, '\n');

        if (!projectId || !clientEmail || !privateKey) {
            this.logger.warn('[PushFcmService] Firebase credentials not configured — push notifications will be skipped');
            return;
        }

        if (admin.apps.length === 0) {
            this.app = admin.initializeApp({
                credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
            });
        } else {
            this.app = admin.apps[0]!;
        }
    }

    /**
     * Get all active FCM tokens for a user.
     */
    async getUserFcmTokens(userId: number): Promise<string[]> {
        const sessions = await this.prisma.userFirebaseSession.findMany({
            where: { user_id: userId, fcm_token: { not: null } },
            select: { fcm_token: true },
        });
        return sessions.map((s) => s.fcm_token!).filter(Boolean);
    }

    /**
     * Send to a single FCM token.
     * Returns success flag and whether the token should be deleted (invalid/expired).
     */
    async sendToToken(token: string, title: string, body: string, data?: Record<string, string>): Promise<FcmSendResult> {
        if (!this.app) {
            this.logger.warn('[PushFcmService] Firebase not initialized — skipping push');
            return { success: false, shouldDelete: false };
        }

        try {
            await this.app.messaging().send({
                token,
                notification: { title, body },
                data: data ?? {},
                android: {
                    priority: 'high',
                    notification: { sound: 'default', channelId: 'default' },
                },
                apns: {
                    payload: { aps: { sound: 'default' } },
                },
            });
            return { success: true, shouldDelete: false };
        } catch (err: any) {
            const code: string = err?.errorInfo?.code ?? err?.code ?? '';
            const shouldDelete = INVALID_TOKEN_CODES.has(code);
            this.logger.warn(`[PushFcmService] sendToToken failed — code: ${code}, shouldDelete: ${shouldDelete}`);
            return { success: false, shouldDelete };
        }
    }

    /**
     * Send to all FCM tokens of a user.
     * Automatically deletes invalid tokens.
     * Returns true if at least one token succeeded.
     */
    async sendToUser(userId: number, title: string, body: string, data?: Record<string, string>): Promise<boolean> {
        const tokens = await this.getUserFcmTokens(userId);
        if (!tokens.length) return false;

        let anySuccess = false;
        const tokensToDelete: string[] = [];

        for (const token of tokens) {
            const result = await this.sendToToken(token, title, body, data);
            if (result.success) anySuccess = true;
            if (result.shouldDelete) tokensToDelete.push(token);
        }

        if (tokensToDelete.length > 0) {
            await this.prisma.userFirebaseSession.deleteMany({
                where: { fcm_token: { in: tokensToDelete } },
            });
        }

        return anySuccess;
    }
}
