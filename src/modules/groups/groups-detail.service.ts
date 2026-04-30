import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { ScopeActor } from '../../common/scoping/scope.types';
import type { GroupDetailDto } from './dto/group-detail.dto';

/**
 * GRP-05 + GRP-06 — group detail (overview) service.
 *
 * GRP-05 hard rule (from ROADMAP §"Phase 4" success criterion #3, mirrored in
 * CONTEXT D-19):
 *   "curator A cannot see curator B's groups via direct URL access; admin-api
 *    returns 403, not 404 or 200"
 *
 * This is the EXPLICIT divergence from Phase 3's user-detail posture (which returns
 * 404 for out-of-scope to avoid PII existence-leak). Group existence is operationally
 * non-sensitive — the explicit 403 helps staff understand they're hitting a resource
 * they don't own, rather than mistakenly thinking the group was deleted. The roadmap
 * explicitly demands this distinction.
 *
 * Implementation pattern (3 steps):
 *   1. Existence check WITHOUT scope spread — was the group ever real?
 *   2. Scope check on the loaded row — does this actor have access?
 *      - admin           → always allowed
 *      - curator         → allowed iff supervisor_id === actor.id
 *      - teacher / other → never allowed (default-deny per GROUP_SCOPE_RULES)
 *      Failure → ForbiddenException('groups.forbidden_scope').
 *   3. Re-read with full select shape — return GroupDetailDto.
 *
 * Note: this DIVERGES from groups-mutations.service.ts cascadePreview which spreads
 * the scope rule on the existence check (404 for foreign-curator, existence-leak
 * prevention). The cascade-preview is a read-style POST; this is the explicit
 * "fetch this resource" GET, and the success-criterion language is unambiguous.
 */
@Injectable()
export class GroupsDetailService {
    private readonly logger = new Logger(GroupsDetailService.name);

    constructor(private readonly prisma: PrismaService) {}

    public async detail(actor: ScopeActor, id: number): Promise<GroupDetailDto> {
        // Step 1: Existence check WITHOUT scope spread.
        const exists = await this.prisma.group.findFirst({
            where: { id },
            select: { id: true, supervisor_id: true },
        });
        if (!exists) {
            throw new NotFoundException('groups.not_found');
        }

        // Step 2: Scope check on the loaded row.
        // admin always passes; curator must own the group; teacher (and any other role)
        // is default-deny per GROUP_SCOPE_RULES.teacher = { id: { in: [] } }.
        if (actor.role_name !== 'admin') {
            const allowed =
                actor.role_name === 'curator' && Number(exists.supervisor_id ?? 0) === actor.id;
            if (!allowed) {
                throw new ForbiddenException('groups.forbidden_scope');
            }
        }

        // Step 3: Re-read with full select.
        const row: any = await this.prisma.group.findFirst({
            where: { id },
            select: {
                id: true,
                name: true,
                status: true,
                supervisor: { select: { id: true, full_name: true } },
                creator: { select: { id: true, full_name: true } },
                _count: { select: { members: true } },
            },
        });
        // Race window: row could vanish between Step 1 and Step 3. Defensive 404.
        if (!row) throw new NotFoundException('groups.not_found');

        return {
            id: Number(row.id),
            name: row.name,
            status: row.status,
            supervisor: row.supervisor
                ? { id: Number(row.supervisor.id), full_name: row.supervisor.full_name ?? null }
                : null,
            creator: row.creator
                ? { id: Number(row.creator.id), full_name: row.creator.full_name ?? null }
                : null,
            member_count: row._count?.members ?? 0,
        };
    }
}
