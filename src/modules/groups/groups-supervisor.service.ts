import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { ChangeSupervisorDto } from './dto/change-supervisor.dto';
import type { GroupDetailDto } from './dto/group-detail.dto';

/**
 * GRP-02 — supervisor change service (Plan 03).
 *
 * PATCH /admin-api/v1/admin/groups/:id/supervisor
 *
 * Behavior:
 *   - admin-only at controller layer (@Roles('admin')); defensive belt-and-suspenders
 *     `actor.role_name !== 'admin'` check here.
 *   - Validates target supervisor exists + is staff (`role_name in ('admin','curator')`).
 *     Rejects with NotFoundException('groups.supervisor.not_found') otherwise. Preserves
 *     invariant: Group.supervisor_id always references staff.
 *   - dto.supervisor_id === 0 means "clear assignment" (mapped to null at the DB).
 *     Documented sentinel from ChangeSupervisorDto header.
 *   - Wraps the update in `prisma.$transaction([...])` for consistency with Phase 3
 *     Plan 04 role-change pattern (single-op transaction; future extensions can append
 *     additional writes without restructuring).
 *
 * Audit:
 *   - Controller carries @Audit('groups.supervisor.change', 'group').
 *   - The response shape includes `previous_supervisor_id` so AuditInterceptor records
 *     the before-state via response shape (cheapest before+after capture; mirrors Phase 3
 *     Plan 04 trick). The admin-client should NOT display this field — it's audit metadata.
 */
@Injectable()
export class GroupsSupervisorService {
    private readonly logger = new Logger(GroupsSupervisorService.name);

    constructor(private readonly prisma: PrismaService) {}

    public async change(
        actor: ScopeActor,
        id: number,
        dto: ChangeSupervisorDto,
    ): Promise<GroupDetailDto & { previous_supervisor_id: number | null }> {
        if (actor.role_name !== 'admin') {
            throw new ForbiddenException('groups.supervisor.forbidden');
        }

        // Fetch current group + supervisor for audit metadata.
        const current = await this.prisma.group.findFirst({
            where: { id },
            select: { id: true, supervisor_id: true },
        });
        if (!current) {
            throw new NotFoundException('groups.not_found');
        }

        const previous_supervisor_id =
            current.supervisor_id != null ? Number(current.supervisor_id) : null;

        // 0 means clear; positive int means assign.
        const targetSupervisorId: number | null = dto.supervisor_id === 0 ? null : dto.supervisor_id;

        // If assigning, validate target exists + is staff (admin or curator).
        // Preserves invariant: Group.supervisor_id always references staff (T-04-22 mitigation).
        if (targetSupervisorId !== null) {
            const sup = await this.prisma.user.findFirst({
                where: { id: targetSupervisorId, deleted_at: null },
                select: { id: true, role_name: true },
            });
            if (!sup || !['admin', 'curator'].includes(sup.role_name)) {
                throw new NotFoundException('groups.supervisor.not_found');
            }
        }

        // Atomic update — single-op tx (consistency with Phase 3 Plan 04 role-change shape).
        await this.prisma.$transaction([
            this.prisma.group.update({
                where: { id },
                data: { supervisor_id: targetSupervisorId },
            }),
        ]);

        // Re-fetch with full select shape.
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
        if (!row) {
            // Race window: row could vanish between update and re-fetch. Defensive 404.
            throw new NotFoundException('groups.not_found');
        }

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
            // Included in response so AuditInterceptor records the before-state in NDJSON meta.
            // NOT a UI field — admin-client surfaces only the post-change state.
            previous_supervisor_id,
        };
    }
}
