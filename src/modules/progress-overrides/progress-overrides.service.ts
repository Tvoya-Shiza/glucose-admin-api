import {
    BadRequestException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { PrismaService } from '../../prisma/prisma.service';
import type { BulkGrantOverridesDto } from './dto/bulk-grant-overrides.dto';
import type { BulkRevokeOverridesDto } from './dto/bulk-revoke-overrides.dto';
import type { ListOverridesQueryDto } from './dto/list-overrides-query.dto';
import type {
    BulkGrantResultDto,
    BulkRevokeResultDto,
    OverrideListResponseDto,
    OverrideRowDto,
} from './dto/override-row.dto';

/**
 * Phase 19 — content-unlock overrides service.
 *
 * Operates on `course_content_overrides` rows, one per (target × course × item).
 * Target is either user_id or group_id (xor enforced in this service — see
 * `resolveTarget`). Group rows take effect for every current and future
 * member of the group via the same mechanism as group-scoped course access.
 *
 * Audit + RBAC live on the controller; this service is permission-agnostic
 * beyond the standard "course exists" / "item belongs to course" guards.
 *
 * Conflict policy on grant: silently skip duplicates (Prisma `skipDuplicates`)
 * — the bulk surface is naturally idempotent, and re-clicking "Save" in the
 * UI should not produce noisy 409s.
 */
@Injectable()
export class ProgressOverridesService {
    private readonly logger = new Logger(ProgressOverridesService.name);

    constructor(private readonly prisma: PrismaService) {}

    public async list(
        courseId: number,
        query: ListOverridesQueryDto,
    ): Promise<OverrideListResponseDto> {
        await this.assertCourseExists(courseId);
        const target = this.resolveTarget(query.target_kind, query.target_id);

        const rows = await this.prisma.courseContentOverride.findMany({
            where: {
                webinar_id: courseId,
                ...target.where,
            },
            select: {
                id: true,
                item_id: true,
                note: true,
                created_at: true,
                expires_at: true,
                granted_by_admin: { select: { id: true, full_name: true } },
                item: { select: { type: true, chapter_id: true } },
            },
            orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        });

        const out: OverrideRowDto[] = rows.map((r) => ({
            id: Number(r.id),
            item_id: Number(r.item_id),
            item_type: String(r.item?.type ?? 'file'),
            chapter_id: Number(r.item?.chapter_id ?? 0),
            note: r.note ?? null,
            granted_at: Number(r.created_at),
            expires_at: r.expires_at ?? null,
            granted_by: r.granted_by_admin
                ? { id: Number(r.granted_by_admin.id), full_name: r.granted_by_admin.full_name ?? null }
                : null,
        }));

        return { rows: out, total: out.length };
    }

    public async bulkGrant(
        actor: ScopeActor,
        courseId: number,
        dto: BulkGrantOverridesDto,
    ): Promise<BulkGrantResultDto> {
        await this.assertCourseExists(courseId);
        const target = this.resolveTarget(dto.target.kind, dto.target.target_id);
        await this.assertItemsBelongToCourse(courseId, dto.item_ids);

        const now = Math.floor(Date.now() / 1000);

        // Find existing overrides for this target × course × item so we can
        // report skipped count accurately (Prisma's createMany skipDuplicates
        // only reports the created count, not which IDs collided).
        const existing = await this.prisma.courseContentOverride.findMany({
            where: {
                webinar_id: courseId,
                item_id: { in: dto.item_ids },
                ...target.where,
            },
            select: { item_id: true },
        });
        const existingIds = new Set(existing.map((e) => Number(e.item_id)));
        const toCreate = dto.item_ids.filter((id) => !existingIds.has(id));

        if (toCreate.length === 0) {
            return { created: 0, skipped: dto.item_ids.length, created_item_ids: [] };
        }

        const data = toCreate.map((item_id) => ({
            webinar_id: courseId,
            item_id,
            user_id: target.user_id,
            group_id: target.group_id,
            granted_by_admin_id: actor.id,
            note: dto.note ?? null,
            created_at: now,
            expires_at: dto.expires_at ?? null,
        }));

        const result = await this.prisma.courseContentOverride.createMany({
            data,
            skipDuplicates: true,
        });

        this.logger.log(
            `progress_overrides bulk-grant: course=${courseId} target=${dto.target.kind}:${dto.target.target_id} created=${result.count} skipped=${existingIds.size}`,
        );

        return {
            created: result.count,
            skipped: existingIds.size,
            created_item_ids: toCreate,
        };
    }

    public async bulkRevoke(
        courseId: number,
        dto: BulkRevokeOverridesDto,
    ): Promise<BulkRevokeResultDto> {
        await this.assertCourseExists(courseId);
        const target = this.resolveTarget(dto.target.kind, dto.target.target_id);

        const result = await this.prisma.courseContentOverride.deleteMany({
            where: {
                webinar_id: courseId,
                item_id: { in: dto.item_ids },
                ...target.where,
            },
        });

        this.logger.log(
            `progress_overrides bulk-revoke: course=${courseId} target=${dto.target.kind}:${dto.target.target_id} deleted=${result.count}`,
        );

        return { deleted: result.count };
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    /**
     * Convert a (kind, id) pair into the where-fragment + insert-payload
     * fields that satisfy the xor invariant.
     */
    private resolveTarget(
        kind: 'user' | 'group',
        id: number,
    ): { where: { user_id?: number; group_id?: number }; user_id: number | null; group_id: number | null } {
        if (kind === 'user') {
            return { where: { user_id: id }, user_id: id, group_id: null };
        }
        return { where: { group_id: id }, user_id: null, group_id: id };
    }

    private async assertCourseExists(courseId: number): Promise<void> {
        const c = await this.prisma.webinar.findUnique({
            where: { id: courseId },
            select: { id: true, deleted_at: true },
        });
        if (!c || c.deleted_at !== null) {
            throw new NotFoundException('progress_overrides.course_not_found');
        }
    }

    /**
     * Verify every item_id belongs to a chapter of `courseId`. Rejects the
     * whole batch (400) on the first mismatch — operators rarely mix courses
     * unintentionally, and a partial accept would be more confusing than a
     * full reject.
     */
    private async assertItemsBelongToCourse(courseId: number, itemIds: number[]): Promise<void> {
        if (itemIds.length === 0) return;
        const valid = await this.prisma.webinarChapterItem.findMany({
            where: {
                id: { in: itemIds },
                webinar_chapter: { webinar_id: courseId },
            },
            select: { id: true },
        });
        if (valid.length !== itemIds.length) {
            const validSet = new Set(valid.map((v) => v.id));
            const invalid = itemIds.filter((id) => !validSet.has(id));
            throw new BadRequestException({
                code: 'progress_overrides.invalid_items',
                message: `Items do not belong to course ${courseId}`,
                invalid_item_ids: invalid,
            });
        }
    }
}
