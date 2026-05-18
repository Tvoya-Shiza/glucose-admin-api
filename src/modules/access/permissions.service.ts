import { Injectable, Logger } from '@nestjs/common';
import type { RoleName } from '@shared/roles';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionsCache } from './permissions.cache';

export interface PermissionActor {
    id: number;
    role_name: RoleName;
    role_id: number;
}

/**
 * Central RBAC checker.
 *
 * Contract:
 *  - role_name === 'admin' → returns true unconditionally (super-bypass; no Redis/DB).
 *  - Unknown permission code → returns false (NEVER throws — protects against typos).
 *  - Redis unavailable → falls back to DB and logs a warning (NEVER throws).
 *  - Guards use the boolean result to decide 403; the service itself never throws.
 *
 * Hot path:
 *  - getRolePermissions(roleId) hits Redis first (geonline-admin:perms:role:<id>, TTL 10 min).
 *  - On miss, SELECT permission.code from role_permissions JOIN permissions, then SET.
 *  - invalidateRoleCache(roleId) is called from AccessService.setRolePermissions().
 */
@Injectable()
export class PermissionsService {
    private readonly logger = new Logger(PermissionsService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly cache: PermissionsCache,
    ) {}

    public async can(actor: PermissionActor, code: string): Promise<boolean> {
        if (actor.role_name === 'admin') return true;
        if (!code) return false;
        const set = await this.getRolePermissions(actor.role_id);
        return set.has(code);
    }

    public async canAny(actor: PermissionActor, codes: string[]): Promise<boolean> {
        if (actor.role_name === 'admin') return true;
        if (codes.length === 0) return true;
        const set = await this.getRolePermissions(actor.role_id);
        return codes.some((c) => set.has(c));
    }

    public async canAll(actor: PermissionActor, codes: string[]): Promise<boolean> {
        if (actor.role_name === 'admin') return true;
        if (codes.length === 0) return true;
        const set = await this.getRolePermissions(actor.role_id);
        return codes.every((c) => set.has(c));
    }

    public async getRolePermissions(roleId: number): Promise<Set<string>> {
        const cached = await this.cache.get(roleId);
        if (cached) return new Set(cached);

        const rows = await this.prisma.rolePermission
            .findMany({
                where: { role_id: roleId },
                select: { permission: { select: { code: true } } },
            })
            .catch((err) => {
                this.logger.warn(`getRolePermissions(${roleId}) DB read failed: ${(err as Error).message}`);
                return [] as Array<{ permission: { code: string } }>;
            });

        const codes = rows.map((r) => r.permission.code);
        await this.cache.set(roleId, codes);
        return new Set(codes);
    }

    public async invalidateRoleCache(roleId: number): Promise<void> {
        await this.cache.invalidate(roleId);
    }

    /**
     * Returns the full set of permission codes effective for the actor.
     * For admin → returns every code in the catalog (so the client `<Can>`
     * universally returns true without an admin-specific branch).
     * For others → returns the role's grants.
     */
    public async listEffectivePermissions(actor: PermissionActor): Promise<string[]> {
        if (actor.role_name === 'admin') {
            const all = await this.prisma.permission
                .findMany({ select: { code: true } })
                .catch((err) => {
                    this.logger.warn(`listEffectivePermissions admin DB read failed: ${(err as Error).message}`);
                    return [] as Array<{ code: string }>;
                });
            return all.map((p) => p.code);
        }
        const set = await this.getRolePermissions(actor.role_id);
        return Array.from(set);
    }
}
