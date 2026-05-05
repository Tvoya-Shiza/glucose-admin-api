import { Injectable, Logger } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import type { Redis } from 'ioredis';

/**
 * MailingsCacheService — Phase 8 Plan 05. Lightweight Redis wrapper for the
 * mailings history surface. Mirrors PushCacheService verbatim (read-through
 * getOrSet + SCAN/UNLINK invalidation, tolerant of Redis errors so the API
 * stays up if Redis flaps).
 *
 * Namespace: geonline-admin:mailings:* (Plan 01 MAILINGS_INVALIDATE_PATTERN).
 * Sub-prefix: MAILINGS_HISTORY_PREFIX.
 *
 * Default TTL is 60 seconds (D-18) — short enough that newly-sent mailings
 * surface in admin history quickly, long enough that pagination clicks coalesce.
 */
@Injectable()
export class MailingsCacheService {
    private readonly logger = new Logger(MailingsCacheService.name);

    public static readonly DEFAULT_TTL_SECONDS = 60;

    constructor(@InjectRedis() private readonly redis: Redis) {}

    public async getOrSet<T>(
        key: string,
        fn: () => Promise<T>,
        ttlSeconds: number = MailingsCacheService.DEFAULT_TTL_SECONDS,
    ): Promise<T> {
        try {
            const raw = await this.redis.get(key);
            if (raw) {
                try {
                    return JSON.parse(raw) as T;
                } catch (err) {
                    this.logger.warn(`getOrSet: unparsable cached value at ${key}: ${(err as Error).message}`);
                }
            }
        } catch (err) {
            this.logger.warn(`getOrSet: Redis read failed for ${key}: ${(err as Error).message} — bypassing cache`);
            return fn();
        }

        const value = await fn();
        try {
            const serialized = JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
            await this.redis.set(key, serialized, 'EX', Math.max(1, Math.floor(ttlSeconds)));
        } catch (err) {
            this.logger.warn(`getOrSet: Redis write failed for ${key}: ${(err as Error).message}`);
        }
        return value;
    }

    public async invalidate(pattern: string): Promise<void> {
        try {
            let cursor = '0';
            do {
                const [next, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
                cursor = next;
                if (keys.length > 0) {
                    await this.redis.unlink(...keys);
                }
            } while (cursor !== '0');
        } catch (err) {
            this.logger.warn(`invalidate: Redis SCAN/UNLINK failed for ${pattern}: ${(err as Error).message}`);
        }
    }
}
