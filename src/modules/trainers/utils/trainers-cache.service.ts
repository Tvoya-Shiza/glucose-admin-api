import { Injectable, Logger } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import type { Redis } from 'ioredis';

/**
 * TrainersCacheService — read-through cache + pattern-invalidation wrapper for the
 * `geonline-admin:trainers:*` namespace.
 *
 * Mirror of QuizzesCacheService (Phase 6). Same getOrSet shape, same SCAN+UNLINK
 * invalidation. Falls back to executing fn() directly on Redis errors so the API
 * stays up if Redis flaps.
 *
 * BigInt-as-string note: trainer-attempt ids are BigInt in MySQL. Responses are
 * serialized by BigIntStringInterceptor BEFORE leaving the controller, but cache
 * writes happen at the service layer where JSON.stringify cannot handle BigInt —
 * the value transformer below casts BigInt to string. Trainer-results services
 * additionally stringify attempt ids in their row mappers, so this is defensive.
 */
@Injectable()
export class TrainersCacheService {
    private readonly logger = new Logger(TrainersCacheService.name);

    public static readonly DEFAULT_TTL_SECONDS = 60;

    constructor(@InjectRedis() private readonly redis: Redis) {}

    public async getOrSet<T>(key: string, fn: () => Promise<T>, ttlSeconds: number = TrainersCacheService.DEFAULT_TTL_SECONDS): Promise<T> {
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
