import { Injectable, Logger } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { hostname } from 'os';

/**
 * Phase 8 Plan 04 — admin-side @CronLock.
 *
 * Vendored from glucose-api/src/common/decorators/cron-lock.decorator.ts (Phase 1 Plan 04).
 * Same SET NX PX semantics + Lua check-and-delete on release. Redis lock keys live under
 * cron-lock:* (distinct from glucose-admin's geonline-admin:* cache namespace) to prevent
 * collisions with glucose-api's lock keys when both clusters share the same Redis host.
 *
 * Lock-name convention for admin-api: prefix every lock with 'admin-' so a glucose-api
 * cron and admin-api cron with similar concerns (e.g. 'admin-push-scheduled' vs glucose-api's
 * 'trigger3-inactivity') do not share the same Redis key.
 *
 * --- original notes (verbatim from glucose-api) ---
 *
 * Distributed cron lock for PM2 cluster mode.
 *
 * Each @Cron handler in a clustered Nest API fires N times (once per instance).
 * @CronLock wraps a handler so only one instance per tick wins; others observe the lock and skip.
 *
 * Backed by Redis SET NX PX with `cron-lock:<name>` keys.
 *
 * TTL guidance: 2x expected duration. If a handler exceeds the TTL, the next tick may run
 * concurrently — handlers must be idempotent (deleteMany on a frozen ID list is naturally safe;
 * external side effects like push notifications must guard with their own dedup).
 */

@Injectable()
export class CronLockService {
    private readonly logger = new Logger(CronLockService.name);
    private readonly instanceId = `${hostname()}-${process.pid}`;

    constructor(@InjectRedis() private readonly redis: Redis) {}

    public async acquire(name: string, ttlMs: number): Promise<string | null> {
        const key = `cron-lock:${name}`;
        const token = `${this.instanceId}:${Date.now()}`;
        try {
            const ok = await this.redis.set(key, token, 'PX', ttlMs, 'NX');
            if (ok === 'OK') {
                this.logger.log(`cron-lock acquired: ${name} (ttl=${ttlMs}ms, instance=${this.instanceId})`);
                return token;
            }
            this.logger.log(`cron-lock skipped: ${name} still held by another instance`);
            return null;
        } catch (err) {
            // If Redis is unavailable, fall back to running the handler — better to risk a duplicate
            // than to silently stop scheduled work entirely. Document this trade-off here.
            this.logger.error(`cron-lock redis error for ${name}; running anyway: ${(err as Error).message}`);
            return token;
        }
    }

    public async release(name: string, token: string): Promise<void> {
        const key = `cron-lock:${name}`;
        try {
            // Lua check-and-delete to avoid releasing a lock the instance no longer owns.
            const lua = `
                if redis.call('get', KEYS[1]) == ARGV[1] then
                    return redis.call('del', KEYS[1])
                else
                    return 0
                end
            `;
            await this.redis.eval(lua, 1, key, token);
        } catch (err) {
            this.logger.warn(`cron-lock release failed for ${name}: ${(err as Error).message}`);
        }
    }
}

/**
 * Method decorator that wraps a @Cron handler with acquire/release semantics.
 * Usage:
 *   @CronLock('admin-push-scheduled', 120_000)
 *   @Cron(CronExpression.EVERY_MINUTE)
 *   async fireDuePushes() { ... }
 *
 * The decorated class MUST inject CronLockService as a public readonly property named `cronLock`.
 * (No reflection — explicit injection keeps Nest DI graphs simple.)
 */
export function CronLock(name: string, ttlMs: number): MethodDecorator {
    return (target, propertyKey, descriptor: PropertyDescriptor) => {
        const original = descriptor.value;
        descriptor.value = async function (...args: any[]) {
            const lockSvc: CronLockService | undefined = (this as any).cronLock;
            if (!lockSvc) {
                throw new Error(
                    `@CronLock requires the host class to inject CronLockService as 'this.cronLock' (method: ${String(propertyKey)})`
                );
            }
            const token = await lockSvc.acquire(name, ttlMs);
            if (!token) {
                return; // Another instance holds the lock; this one skips this tick.
            }
            try {
                return await original.apply(this, args);
            } finally {
                await lockSvc.release(name, token);
            }
        };
        return descriptor;
    };
}
