import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CronLock, CronLockService } from '../../common/decorators/cron-lock.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { CreditsConductService } from './credits-conduct.service';
import { nowSec, SESSION_GRACE_SEC } from './utils/time';

/**
 * Credit-session sweepers (contract §crons).
 *
 *   every minute — finalize every in_progress session whose ends_at + 5s grace
 *   has passed as 'expired' (score from marks, journal + notification + launch
 *   completion via CreditsConductService.finalizeSession — idempotent, so a
 *   race with a curator's /finish is harmless).
 *
 *   hourly — cancel pending sessions older than 24h (launch was never started
 *   for that student), then complete launches with nothing left to run.
 *
 * @CronLock keeps one PM2 instance per tick (SET NX PX; ttl per contract).
 */
const STALE_PENDING_SEC = 86_400;
const TICK_LIMIT = 500;

@Injectable()
export class CreditsExpiryCronService {
    private readonly logger = new Logger(CreditsExpiryCronService.name);

    constructor(
        public readonly cronLock: CronLockService,
        private readonly prisma: PrismaService,
        private readonly conduct: CreditsConductService,
    ) {}

    @Cron(CronExpression.EVERY_MINUTE)
    @CronLock('credits-expire-sessions', 120_000)
    public async expireOverdueSessions(): Promise<void> {
        const now = nowSec();
        const overdue = await this.prisma.creditSession.findMany({
            where: { status: 'in_progress', ends_at: { lt: now - SESSION_GRACE_SEC } },
            select: { id: true },
            take: TICK_LIMIT,
        });
        if (overdue.length === 0) return;

        this.logger.log(`expiring ${overdue.length} overdue credit session(s)`);
        for (const s of overdue) {
            try {
                await this.conduct.finalizeSession(s.id, 'expired', 'timeout');
            } catch (err) {
                this.logger.warn(`expire session=${s.id.toString()} failed: ${(err as Error)?.message}`);
            }
        }
    }

    @Cron(CronExpression.EVERY_HOUR)
    @CronLock('credits-cancel-stale-pending', 7_200_000)
    public async cancelStalePendingSessions(): Promise<void> {
        const now = nowSec();
        const stale = await this.prisma.creditSession.findMany({
            where: { status: 'pending', created_at: { lt: now - STALE_PENDING_SEC } },
            select: { id: true, launch_id: true },
            take: TICK_LIMIT,
        });
        if (stale.length === 0) return;

        const ids = stale.map((s) => s.id);
        const res = await this.prisma.creditSession.updateMany({
            where: { id: { in: ids }, status: 'pending' },
            data: { status: 'cancelled', finished_at: now },
        });
        this.logger.log(`cancelled ${res.count} stale pending credit session(s)`);

        // Launches whose remaining sessions all reached a terminal state are done.
        const launchIds = Array.from(new Set(stale.map((s) => s.launch_id.toString()))).map((id) => BigInt(id));
        for (const launchId of launchIds) {
            try {
                const remaining = await this.prisma.creditSession.count({
                    where: { launch_id: launchId, status: { in: ['pending', 'in_progress'] } },
                });
                if (remaining === 0) {
                    await this.prisma.creditLaunch.updateMany({ where: { id: launchId, status: 'active' }, data: { status: 'completed' } });
                }
            } catch (err) {
                this.logger.warn(`launch completion sweep failed launch=${launchId.toString()}: ${(err as Error)?.message}`);
            }
        }
    }
}
