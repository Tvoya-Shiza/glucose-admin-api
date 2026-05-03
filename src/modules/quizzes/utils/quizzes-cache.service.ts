import { Injectable, Logger } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import type { Redis } from 'ioredis';

/**
 * QuizzesCacheService — read-through cache + pattern-invalidation wrapper for the
 * `geonline-admin:quizzes:*` namespace.
 *
 * Mirror of CoursesCacheService (Phase 5 Plan 03 wire-up). Same getOrSet shape,
 * same SCAN+UNLINK invalidation. Falls back to executing fn() directly on Redis
 * errors so the API stays up if Redis flaps.
 *
 * BigInt-as-string note: admin-api responses with BigInt fields are serialized by
 * BigIntStringInterceptor BEFORE leaving the controller; cache writes happen at the
 * service layer. JSON.stringify cannot serialize BigInt directly — the value
 * transformer below casts BigInt to string. All Phase 6 entity ids are Int → number
 * already (Plan 01 decision), so this is defensive.
 */
@Injectable()
export class QuizzesCacheService {
    private readonly logger = new Logger(QuizzesCacheService.name);

    public static readonly DEFAULT_TTL_SECONDS = 60; // Plan 02 list-cache TTL.

    constructor(@InjectRedis() private readonly redis: Redis) {}

    public async getOrSet<T>(key: string, fn: () => Promise<T>, ttlSeconds: number = QuizzesCacheService.DEFAULT_TTL_SECONDS): Promise<T> {
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
     * SCAN + UNLINK across a glob pattern. Tolerant of Redis errors — never throws
     * to the caller. A failed invalidation results in temporary staleness, not a 500.
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
