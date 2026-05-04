import { Injectable, Logger } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import type { Redis } from 'ioredis';

/**
 * AudienceCacheService — Phase 8 Plan 02. Lightweight Redis wrapper for the
 * audience-preview surface. Mirrors PromocodesCacheService / BlogsCacheService
 * verbatim (read-through getOrSet + SCAN/UNLINK pattern invalidation, tolerant
 * of Redis errors so the API stays up if Redis flaps).
 *
 * Namespace: geonline-admin:push:audience:* (Plan 01 PUSH_AUDIENCE_PREFIX).
 *
 * Default TTL is 30 seconds (D-18) — short enough that a permissive filter
 * doesn't hide newly-eligible users, long enough that back-to-back AudienceSelector
 * keystroke-debounced renders coalesce on the same Redis hit.
 *
 * Returns `{ value, hit }` from getOrSet so the controller can advertise the
 * `cached` flag to the UI ("cache" badge in <AudiencePreview/>).
 */
@Injectable()
export class AudienceCacheService {
    private readonly logger = new Logger(AudienceCacheService.name);

    public static readonly DEFAULT_TTL_SECONDS = 30;

    constructor(@InjectRedis() private readonly redis: Redis) {}

    /**
     * Read-through cache. Returns `{ value, hit }` so callers can surface the
     * cache status to clients without a separate probe.
     */
    public async getOrSet<T>(
        key: string,
        fn: () => Promise<T>,
        ttlSeconds: number = AudienceCacheService.DEFAULT_TTL_SECONDS,
    ): Promise<{ value: T; hit: boolean }> {
        try {
            const raw = await this.redis.get(key);
            if (raw) {
                try {
                    return { value: JSON.parse(raw) as T, hit: true };
                } catch (err) {
                    this.logger.warn(`getOrSet: unparsable cached value at ${key}: ${(err as Error).message}`);
                }
            }
        } catch (err) {
            this.logger.warn(`getOrSet: Redis read failed for ${key}: ${(err as Error).message} — bypassing cache`);
            return { value: await fn(), hit: false };
        }

        const value = await fn();
        try {
            const serialized = JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
            await this.redis.set(key, serialized, 'EX', Math.max(1, Math.floor(ttlSeconds)));
        } catch (err) {
            this.logger.warn(`getOrSet: Redis write failed for ${key}: ${(err as Error).message}`);
        }
        return { value, hit: false };
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
