import { Injectable, Logger } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import type { Redis } from 'ioredis';

/**
 * Redis cache layer for role → permission codes.
 *
 * Key:    geonline-admin:perms:role:<role_id>      (JSON array of codes)
 * TTL:    600 seconds (10 min)
 * Version: geonline-admin:perms:version            (global counter; bumped on any invalidate)
 *
 * The version counter is belt-and-braces for multi-instance: if a `DEL` is missed
 * (e.g. instance restart at the wrong moment), every cached set carries the version
 * it was written at, and `get()` discards entries whose version is below current.
 */
@Injectable()
export class PermissionsCache {
    private static readonly TTL_SECONDS = 600;
    private static readonly KEY_PREFIX = 'geonline-admin:perms:role:';
    private static readonly VERSION_KEY = 'geonline-admin:perms:version';

    private readonly logger = new Logger(PermissionsCache.name);

    constructor(@InjectRedis() private readonly redis: Redis) {}

    public async get(roleId: number): Promise<string[] | null> {
        try {
            const [raw, currentVersionRaw] = await Promise.all([
                this.redis.get(this.key(roleId)),
                this.redis.get(PermissionsCache.VERSION_KEY),
            ]);
            if (!raw) return null;
            const parsed = JSON.parse(raw) as { v: number; codes: string[] };
            const currentVersion = parseInt(currentVersionRaw ?? '0', 10);
            if (parsed.v < currentVersion) {
                // Stale across a missed invalidate — drop and force re-read.
                await this.redis.del(this.key(roleId)).catch(() => undefined);
                return null;
            }
            return parsed.codes;
        } catch (err) {
            this.logger.warn(`cache.get(${roleId}) failed: ${(err as Error).message}`);
            return null;
        }
    }

    public async set(roleId: number, codes: string[]): Promise<void> {
        try {
            const versionRaw = await this.redis.get(PermissionsCache.VERSION_KEY);
            const version = parseInt(versionRaw ?? '0', 10);
            const payload = JSON.stringify({ v: version, codes });
            await this.redis.set(this.key(roleId), payload, 'EX', PermissionsCache.TTL_SECONDS);
        } catch (err) {
            this.logger.warn(`cache.set(${roleId}) failed: ${(err as Error).message}`);
        }
    }

    public async invalidate(roleId: number): Promise<void> {
        try {
            await Promise.all([this.redis.del(this.key(roleId)), this.redis.incr(PermissionsCache.VERSION_KEY)]);
        } catch (err) {
            this.logger.warn(`cache.invalidate(${roleId}) failed: ${(err as Error).message}`);
        }
    }

    public async invalidateAll(): Promise<void> {
        try {
            // Bump version — all cached entries become stale on next read.
            await this.redis.incr(PermissionsCache.VERSION_KEY);
        } catch (err) {
            this.logger.warn(`cache.invalidateAll failed: ${(err as Error).message}`);
        }
    }

    private key(roleId: number): string {
        return `${PermissionsCache.KEY_PREFIX}${roleId}`;
    }
}
