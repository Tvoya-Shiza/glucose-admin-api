import { Injectable, Logger } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import type { Redis } from 'ioredis';

/**
 * PushCacheService — Phase 8 Plan 03. Lightweight Redis wrapper for the push
 * history surface. Mirrors AudienceCacheService verbatim (read-through getOrSet
 * + SCAN/UNLINK invalidation, tolerant of Redis errors so the API stays up if
 * Redis flaps).
 *
 * Namespace: geonline-admin:push:* (Plan 01 PUSH_INVALIDATE_PATTERN). Specific
 * sub-prefixes:
 *   - PUSH_HISTORY_PREFIX     (Plan 03; this service; 60s TTL)
 *   - PUSH_AUDIENCE_PREFIX    (Plan 02; AudienceCacheService; 30s TTL)
 *   - PUSH_SCHEDULED_PREFIX   (Plan 04; future; 60s TTL)
 *
 * Default TTL is 60 seconds (D-18) — short enough that newly-sent rows surface
 * in admin history quickly, long enough that pagination clicks coalesce.
 */
@Injectable()
export class PushCacheService {
    private readonly logger = new Logger(PushCacheService.name);

    public static readonly DEFAULT_TTL_SECONDS = 60;

    constructor(@InjectRedis() private readonly redis: Redis) {}

    public async getOrSet<T>(
        key: string,
        fn: () => Promise<T>,
        ttlSeconds: number = PushCacheService.DEFAULT_TTL_SECONDS,
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
