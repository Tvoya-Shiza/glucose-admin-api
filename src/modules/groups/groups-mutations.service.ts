import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { buildScopeWhere } from '../../common/scoping/scope.helper';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { GROUP_SCOPE_RULES } from './groups.scope';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import type { GroupDetailDto } from './dto/group-detail.dto';
import type { CascadePreviewResponseDto } from './dto/cascade-preview.dto';

/**
 * GRP-01 + GRP-04 + GRP-05 — group create / update / delete + cascade-preview (Plan 02).
 *
 * Decisions baked in (per Plan 01 schema-gap notes + Plan 02 actions):
 *   - Group has NO `deleted_at` column. DELETE = HARD `prisma.group.delete()`. Schema FK
 *     `onDelete: Cascade` on group_users + chapter_schedules handles dependents.
 *   - "Deactivate" = PATCH with `status: 'inactive'` (UpdateGroupDto). Same endpoint as
 *     "rename" — both pass through `update()`.
 *   - cascade-preview uses scope spread on the existence check. Curator on foreign group
 *     -> NotFoundException (404), NOT 403, because cascade-preview is a read-style
 *     operation and existence-leak prevention applies (Phase 3 posture). Plan 03's GET /:id
 *     is the explicit "fetch this resource" path and DOES return 403 per CONTEXT D-19.
 *   - PATCH/DELETE/POST are gated at the controller via @Roles + a grantable
 *     @RequirePermission (groups.create/edit/delete). No per-tenant WRITE narrowing
 *     currently exists, so a granted curator/teacher can mutate ANY group.
 *
 * Audit (controller layer):
 *   - @Audit('groups.create','group') on create
 *   - @Audit('groups.update','group') on update
 *   - @Audit('groups.delete','group') on hardDelete
 *   - @SkipAudit('cascade-preview is read-only inspection ...') on cascadePreview
 *     (no DB mutation; the actual delete is audited separately)
 *
 * Cache invalidation: callers (the controller) invoke cache.invalidate(GROUPS_LIST_INVALIDATE_PATTERN)
 * after each mutation. Service does NOT touch cache directly to keep the service Prisma-only.
 * Plan 03 may move this responsibility into the service if the cache surface grows.
 */
@Injectable()
export class GroupsMutationsService {
    private readonly logger = new Logger(GroupsMutationsService.name);

    constructor(private readonly prisma: PrismaService) {}

    public async create(actor: ScopeActor, dto: CreateGroupDto): Promise<GroupDetailDto> {
        // Access governed by @Roles + @RequirePermission('groups.create') at the controller.
        // If supervisor_id provided, verify the supervisor exists + is staff.
        if (typeof dto.supervisor_id === 'number' && dto.supervisor_id > 0) {
            const sup = await this.prisma.user.findFirst({
                where: { id: dto.supervisor_id, deleted_at: null },
                select: { id: true, role_name: true },
            });
            if (!sup || !['admin', 'curator'].includes(sup.role_name)) {
                throw new NotFoundException('groups.create.supervisor_not_found');
            }
        }
        const created: any = await this.prisma.group.create({
            data: {
                name: dto.name,
                status: dto.status,
                creator_id: actor.id,
                supervisor_id: dto.supervisor_id ?? null,
            },
            select: this.detailSelect(),
        });
        return this.toDetail(created);
    }

    public async update(actor: ScopeActor, id: number, dto: UpdateGroupDto): Promise<GroupDetailDto> {
        // Access governed by @Roles + @RequirePermission('groups.edit') at the controller.
        // Existence check (no per-tenant WRITE narrowing currently exists for groups).
        const exists = await this.prisma.group.findFirst({ where: { id }, select: { id: true } });
        if (!exists) throw new NotFoundException('groups.not_found');

        const data: Record<string, unknown> = {};
        if (typeof dto.name === 'string') data.name = dto.name;
        if (typeof dto.status === 'string') data.status = dto.status;

        if (Object.keys(data).length === 0) {
            // No-op update — re-fetch and return current state.
            const row: any = await this.prisma.group.findFirst({ where: { id }, select: this.detailSelect() });
            return this.toDetail(row);
        }

        await this.prisma.group.update({ where: { id }, data });
        const updated: any = await this.prisma.group.findFirst({
            where: { id },
            select: this.detailSelect(),
        });
        return this.toDetail(updated);
    }

    public async hardDelete(actor: ScopeActor, id: number): Promise<{ id: number; deleted: true }> {
        // Access governed by @Roles + @RequirePermission('groups.delete') at the controller.
        const exists = await this.prisma.group.findFirst({ where: { id }, select: { id: true } });
        if (!exists) throw new NotFoundException('groups.not_found');
        // Hard delete — schema FKs `onDelete: Cascade` handle group_users + chapter_schedules.
        await this.prisma.group.delete({ where: { id } });
        return { id, deleted: true };
    }

    public async cascadePreview(actor: ScopeActor, id: number): Promise<CascadePreviewResponseDto> {
        // Existence check WITH scope spread. Curator on foreign group -> 404 NotFoundException
        // (existence-leak prevention; documented in service header).
        const scopeWhere = buildScopeWhere(actor, GROUP_SCOPE_RULES);
        const exists = await this.prisma.group.findFirst({
            where: { id, ...(scopeWhere as object) },
            select: { id: true },
        });
        if (!exists) throw new NotFoundException('groups.not_found');

        // affected_students: count of GroupUser rows for this group + sample of first 5 names.
        const [total, sampleRows] = await this.prisma.$transaction([
            this.prisma.groupUser.count({ where: { group_id: id } }),
            this.prisma.groupUser.findMany({
                where: { group_id: id },
                select: { user_id: true, user: { select: { full_name: true } } },
                take: 5,
                orderBy: { id: 'asc' },
            }),
        ]);

        return {
            affected_students: total,
            sample_student_names: sampleRows.map((r: any) =>
                r.user?.full_name ?? `user#${Number(r.user_id)}`,
            ),
            affected_schedules: 0,
            affected_schedules_note: 'WebinarChapterSchedule UI lands in Phase 5',
        };
    }

    private detailSelect() {
        return {
            id: true,
            name: true,
            status: true,
            supervisor: { select: { id: true, full_name: true } },
            creator: { select: { id: true, full_name: true } },
            _count: { select: { members: true } },
        } as const;
    }

    private toDetail(row: any): GroupDetailDto {
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
