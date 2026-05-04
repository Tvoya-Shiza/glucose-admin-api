import { Injectable, Logger } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import type { Redis } from 'ioredis';

/**
 * BannersCacheService — lightweight Redis wrapper for the banners surface (Phase 7
 * Plan 03). Mirrors StoriesCacheService verbatim — read-through getOrSet + SCAN/UNLINK
 * pattern invalidation, tolerant of Redis errors (API stays up if Redis flaps).
 *
 * Namespace: geonline-admin:banners:* (Plan 01 BANNERS_INVALIDATE_PATTERN constant).
 *
 * Currently used for invalidation only — list/detail caching is OFF in Plan 03
 * (admin reads are infrequent; staleness from cache misses isn't worth the
 * complexity in this milestone). The class is kept generic so a future polish
 * pass can flip cache READS on by inserting `getOrSet` at the service edges
 * without touching invalidation call sites.
 */
@Injectable()
export class BannersCacheService {
    private readonly logger = new Logger(BannersCacheService.name);

    public static readonly DEFAULT_TTL_SECONDS = 300;

    constructor(@InjectRedis() private readonly redis: Redis) {}

    public async getOrSet<T>(key: string, fn: () => Promise<T>, ttlSeconds: number = BannersCacheService.DEFAULT_TTL_SECONDS): Promise<T> {
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
