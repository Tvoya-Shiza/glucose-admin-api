import { Injectable, Logger } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import type { Redis } from 'ioredis';

/**
 * CoursesCacheService — lightweight Redis wrapper used by Plan 03 to honor the
 * cache wire-up Plan 02 explicitly deferred (see Plan 02 SUMMARY: "Cache invalidation
 * hooks deferred to Plan 03").
 *
 * Contract:
 *   - getOrSet(key, fn, ttl): read-through cache. JSON-serialize fn() result, store with EX.
 *     Falls back to executing fn() directly on Redis errors (mirrors glucose-api
 *     CacheService posture — API stays up if Redis flaps).
 *   - invalidate(pattern): SCAN + UNLINK over a glob pattern. UNLINK is non-blocking;
 *     SCAN avoids the full-keyspace KEYS hazard.
 *
 * Key namespace: enforced at call sites (geonline-admin:courses:*).
 *
 * BigInt-as-string note: admin-api responses with BigInt fields are serialized by
 * BigIntStringInterceptor BEFORE leaving the controller; cache writes happen at the
 * service layer, where BigInts are still real BigInts. JSON.stringify cannot serialize
 * BigInt directly — so getOrSet's value transformer toStringifyJson() walks the value
 * and casts BigInt to string. The matching parser leaves strings as strings (downstream
 * Prisma reads keep BigInt at the boundary; we only cache the controller's eventual
 * shape, where IDs are already plain numbers via Number(row.id) coercion).
 */
@Injectable()
export class CoursesCacheService {
    private readonly logger = new Logger(CoursesCacheService.name);

    public static readonly DEFAULT_TTL_SECONDS = 300; // 5 minutes — same posture as Plan 02 list (uncached today; conservative read-through)

    constructor(@InjectRedis() private readonly redis: Redis) {}

    /**
     * Read-through cache: return parsed cached value, otherwise call fn(), store, return.
     * On any Redis error (read OR write), execute fn() directly and DO NOT throw.
     */
    public async getOrSet<T>(key: string, fn: () => Promise<T>, ttlSeconds: number = CoursesCacheService.DEFAULT_TTL_SECONDS): Promise<T> {
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

    /**
     * SCAN + UNLINK across a glob pattern. Iterates with COUNT=200 to bound the loop
     * cost; UNLINK is asynchronous on the Redis side so the call returns quickly.
     *
     * Tolerant of Redis errors — never throws to the caller. A failed invalidation
     * results in temporary staleness, not a 500.
     */
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
