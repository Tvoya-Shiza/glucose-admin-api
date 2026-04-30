import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { ChangeRoleDto } from './dto/change-role.dto';

/**
 * USR-03 (role-change half) — Plan 04.
 *
 * High-trust mutation: changes both `User.role_id` AND `User.role_name` in a single
 * `prisma.$transaction(...)` so the RBAC discriminator (`role_name`) and the FK
 * (`role_id`) are never out of sync (T-03-31). Audited via `@Audit('users.changeRole', 'user')`
 * on the controller; `ci:audit-required` enforces the decoration.
 *
 * Defensive guards (mirroring threat model):
 *   - admin-only: `actor.role_name !== 'admin'` -> 403 (RolesGuard already gates; this
 *     is belt-and-braces at the service boundary).
 *   - self-demotion: `actor.id === id && target !== 'admin'` -> 403 (T-03-33).
 *   - role pair mismatch: `Role.findUnique(role_id).name !== dto.role_name` -> 400 (T-03-31).
 *   - admin-escalation: `dto.role_name === 'admin'` requires `confirmation === String(id)` (T-03-32).
 *
 * Note on caching: Plans 02/05 own the users-list cache key namespace. The list service
 * does not currently wrap reads in CacheService, so there is no Redis entry to invalidate
 * here. When caching is wired (Plan 05 / future), invalidate `USERS_LIST_INVALIDATE_PATTERN`
 * + `geonline-admin:users:detail:<id>` after a successful role change.
 */
@Injectable()
export class UsersRoleService {
    private readonly logger = new Logger(UsersRoleService.name);

    constructor(private readonly prisma: PrismaService) {}

    public async changeRole(
        actor: ScopeActor,
        id: number,
        dto: ChangeRoleDto,
    ): Promise<{ id: number; role_id: number; role_name: string }> {
        // Belt-and-braces — RolesGuard already enforces admin-only at the controller.
        if (actor.role_name !== 'admin') {
            throw new ForbiddenException('admin_only');
        }

        // T-03-33: prevent admin from demoting themselves to a non-admin role (would
        // lock the platform out — they could no longer reach this endpoint to fix it).
        // Demotion by *another* admin is allowed.
        if (actor.id === id && dto.role_name !== 'admin') {
            throw new ForbiddenException('cannot_demote_self');
        }

        const user = await this.prisma.user.findFirst({
            where: { id, deleted_at: null },
            select: { id: true, role_id: true, role_name: true },
        });
        if (!user) throw new NotFoundException('user_not_found');

        // T-03-31: validate role_id + role_name refer to the SAME row in `roles`.
        const role = await this.prisma.role.findUnique({
            where: { id: dto.role_id },
            select: { id: true, name: true },
        });
        if (!role) throw new BadRequestException('role_not_found');
        if (role.name !== dto.role_name) {
            throw new BadRequestException(`role_mismatch:expected_${role.name}_got_${dto.role_name}`);
        }

        // T-03-32: admin-escalation guard. Server-side gate independent of any UI.
        if (dto.role_name === 'admin') {
            if (!dto.confirmation || dto.confirmation.trim() !== String(id)) {
                throw new BadRequestException('admin_role_confirmation_required');
            }
        }

        // No-op short-circuit when target == current (still returns 200 so callers don't
        // need to special-case "already there"). No transaction or audit-meaningful write.
        if (Number(user.role_id) === Number(role.id) && user.role_name === dto.role_name) {
            return { id: Number(user.id), role_id: Number(user.role_id), role_name: user.role_name };
        }

        const now = Math.floor(Date.now() / 1000);
        // Atomic write: role_id + role_name + updated_at in one transaction. Wrapped even
        // though it's a single update so future cascades (audit-row replay, push-notification
        // dispatch on demotion, etc.) can be appended without changing call shape.
        await this.prisma.$transaction([
            this.prisma.user.update({
                where: { id },
                data: { role_id: dto.role_id, role_name: dto.role_name, updated_at: now },
            }),
        ]);

        return { id: Number(user.id), role_id: dto.role_id, role_name: dto.role_name };
    }
}
