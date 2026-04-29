import { Injectable, Logger } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import type { Redis } from 'ioredis';

export interface RefreshTokenValue {
    user_id: number;
    created_at: number; // Unix seconds
}

/**
 * Redis-backed refresh-token jti allowlist for admin-api.
 *
 * Key namespace: geonline-admin:refresh:<jti>  (DISTINCT from glucose-api's geonline:* keys)
 * Value:        JSON-stringified { user_id, created_at }
 * TTL:          JWT_ADMIN_REFRESH_TTL_SECONDS (default 604800 = 7 days)
 *
 * Rotation is atomic via MULTI/EXEC (AUTH-03):
 *   MULTI
 *   DEL  geonline-admin:refresh:<oldJti>
 *   SET  geonline-admin:refresh:<newJti> <value> EX <ttl>
 *   EXEC
 * If the old jti was already deleted (e.g. concurrent logout), DEL returns 0 — the SET still succeeds.
 */
@Injectable()
export class RefreshTokenRepo {
    private static readonly PREFIX = 'geonline-admin:refresh:';
    private readonly logger = new Logger(RefreshTokenRepo.name);

    constructor(@InjectRedis() private readonly redis: Redis) {}

    private key(jti: string): string {
        return `${RefreshTokenRepo.PREFIX}${jti}`;
    }

    public async set(jti: string, userId: number, ttlSeconds: number): Promise<void> {
        const value: RefreshTokenValue = {
            user_id: userId,
            created_at: Math.floor(Date.now() / 1000),
        };
        await this.redis.set(this.key(jti), JSON.stringify(value), 'EX', ttlSeconds);
    }

    public async exists(jti: string): Promise<RefreshTokenValue | null> {
        const raw = await this.redis.get(this.key(jti));
        if (!raw) return null;
        try {
            return JSON.parse(raw) as RefreshTokenValue;
        } catch (err) {
            this.logger.warn(`refresh-token: unparsable Redis value for jti=${jti}: ${(err as Error).message}`);
            return null;
        }
    }

    public async del(jti: string): Promise<void> {
        // Idempotent — Redis DEL returns 0 if the key didn't exist; we don't surface the difference.
        await this.redis.del(this.key(jti));
    }

    public async rotate(oldJti: string, newJti: string, userId: number, ttlSeconds: number): Promise<void> {
        const value: RefreshTokenValue = {
            user_id: userId,
            created_at: Math.floor(Date.now() / 1000),
        };
        const tx = this.redis.multi();
        tx.del(this.key(oldJti));
        tx.set(this.key(newJti), JSON.stringify(value), 'EX', ttlSeconds);
        const results = await tx.exec();
        if (!results) {
            throw new Error('refresh-token rotation: MULTI/EXEC returned null (transaction aborted)');
        }
        // results[i] = [error | null, reply]; surface the SET reply error if any.
        const setError = results[1]?.[0];
        if (setError) {
            throw new Error(`refresh-token rotation: SET failed: ${setError.message}`);
        }
    }
}
