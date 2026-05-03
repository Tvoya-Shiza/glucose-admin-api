import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { BulkMembersDto, BulkMembersResultDto, BulkMembersResultRowDto } from './dto/bulk-members.dto';
import { ListMembersDto, MemberProgressRequestDto } from './dto/member-progress.dto';
import type {
    MemberListResponseDto,
    MemberProgressResponseDto,
    MemberProgressRowDto,
    MemberRowDto,
} from './dto/group-detail.dto';

/**
 * GRP-03 + GRP-06 — group members service (Plan 04, wave 4).
 *
 * Endpoints serviced:
 *   GET    /admin-api/v1/admin/groups/:id/members            -> listMembers
 *   POST   /admin-api/v1/admin/groups/:id/members            -> bulkAdd  (mode=dry_run|commit)
 *   DELETE /admin-api/v1/admin/groups/:id/members            -> bulkRemove (mode=dry_run|commit)
 *   POST   /admin-api/v1/admin/groups/:id/members/progress   -> progress (lazy load)
 *
 * Scope check (3-step pattern, mirrors GroupsDetailService):
 *   1. existence-check (no scope)         -> 404 if absent
 *   2. role + own-supervisor scope check  -> 403 if foreign-curator / teacher
 *   3. perform action                     -> resource is allowed
 *
 * Idempotency (no @@unique on GroupUser — Plan 01 schema-gap note):
 *   - bulkAdd: findMany existing GroupUser rows, skip duplicates, $transaction.create
 *     each delta in chunks of TX_CHUNK_SIZE. Same shape as Phase 3 Plan 03
 *     `users-detail.service.ts patchMemberships`.
 *   - bulkRemove: deleteMany by (group_id, user_id IN (deltas)). Already-absent rows
 *     are reported as `skip: 'not_a_member'` in the result rows.
 *
 * Confirmation gate (T-04-32, mirrors Phase 3 Plan 05 T-03-42):
 *   When commit-mode `affected > CONFIRM_THRESHOLD` (50), the body MUST carry
 *   `confirmed_count === affected`. Server independently recomputes `affected` from
 *   the same predicate the dry-run uses. Mismatch / missing -> 400 BadRequestException.
 *
 * Course-progress signals (Plan 01 interfaces — schema-verified):
 *   - "Started" (granted) = distinct webinar_id from Sale where buyer_id IN (uids)
 *     AND webinar_id IS NOT NULL AND refund_at IS NULL.
 *   - "Completed"          = distinct item_id from RewardAccounting where
 *     user_id IN (uids) AND type='learning_progress_100'. (NOT WebinarUser.completed_at —
 *     that field does not exist in this schema; CONTEXT D-07 was inaccurate.)
 *
 * Audit posture (controller layer):
 *   - GET     /:id/members           -> exempt (read)
 *   - POST    /:id/members           -> @Audit('groups.members.add', 'group_user')
 *   - DELETE  /:id/members           -> @Audit('groups.members.remove', 'group_user')
 *   - POST    /:id/members/progress  -> @SkipAudit('progress is a read masquerading as
 *     POST due to body shape; no mutation occurs')
 */
@Injectable()
export class GroupsMembersService {
    private readonly logger = new Logger(GroupsMembersService.name);

    /** Server confirmation gate threshold (mirrors Phase 3 Plan 05). */
    public static readonly CONFIRM_THRESHOLD = 50;

    /** Chunk size for chunked $transaction inserts (mirrors Phase 3 Plan 05). */
    public static readonly TX_CHUNK_SIZE = 500;

    public static readonly DEFAULT_PAGE_SIZE = 50;
    public static readonly MAX_PAGE_SIZE = 200;

    constructor(private readonly prisma: PrismaService) {}

    /**
     * 3-step scope check — shared across read + write endpoints. Mirrors the pattern
     * documented in groups-detail.service.ts (GRP-05 explicit 403-not-404).
     *
     * Inline duplication of the detail-service pattern is acceptable here — both
     * services have the same trust boundary; extracting to a shared helper buys
     * minimal benefit but couples lifecycle of two unrelated services. Future cleanup:
     * extract to `groups-scope.guard.ts` if a third group-scoped endpoint lands.
     */
    private async assertScope(actor: ScopeActor, groupId: number): Promise<void> {
        const exists = await this.prisma.group.findFirst({
            where: { id: groupId },
            select: { id: true, supervisor_id: true },
        });
        if (!exists) {
            throw new NotFoundException('groups.not_found');
        }
        if (actor.role_name !== 'admin') {
            const allowed =
                actor.role_name === 'curator' &&
                Number(exists.supervisor_id ?? 0) === actor.id;
            if (!allowed) {
                throw new ForbiddenException('groups.forbidden_scope');
            }
        }
    }

    public async listMembers(
        actor: ScopeActor,
        groupId: number,
        query: ListMembersDto,
    ): Promise<MemberListResponseDto> {
        await this.assertScope(actor, groupId);

        const page = Math.max(1, query.page ?? 1);
        const page_size = Math.min(
            GroupsMembersService.MAX_PAGE_SIZE,
            Math.max(1, query.page_size ?? GroupsMembersService.DEFAULT_PAGE_SIZE),
        );
        const skip = (page - 1) * page_size;

        const where: any = { group_id: groupId };
        if (query.q && query.q.trim().length > 0) {
            // MySQL utf8mb4_general_ci handles case-insensitivity for `contains` natively;
            // Prisma `mode: 'insensitive'` is Postgres-only.
            where.user = { full_name: { contains: query.q.trim() } };
        }
        // `query.window` is decoded but applied client-side per CONTEXT D-20 — the
        // `last_activity` column is in every row of the response anyway, and a server
        // narrowing would change the `total` count in subtle ways during pagination.

        const [total, rows] = await this.prisma.$transaction([
            this.prisma.groupUser.count({ where }),
            this.prisma.groupUser.findMany({
                where,
                select: {
                    created_at: true,
                    user: {
                        select: {
                            id: true,
                            full_name: true,
                            email: true,
                            role_name: true,
                            status: true,
                            last_activity: true,
                        },
                    },
                },
                orderBy: { id: 'desc' },
                take: page_size,
                skip,
            }),
        ]);

        // Defensive: filter rows whose `user` relation came back null (orphan rows after
        // a User cascade delete shouldn't happen given the FK, but the schema has no
        // hard guarantee against stale rows from out-of-band deletes — T-04-36 accepted).
        const out: MemberRowDto[] = (rows as any[])
            .filter((r) => r.user)
            .map((r) => ({
                user_id: Number(r.user.id),
                full_name: r.user.full_name ?? null,
                email: r.user.email ?? null,
                role_name: r.user.role_name,
                status: r.user.status,
                joined_at: Number(r.created_at),
                last_activity: r.user.last_activity
                    ? Math.floor(new Date(r.user.last_activity).getTime() / 1000)
                    : null,
            }));

        return { rows: out, total, page, page_size };
    }

    public async bulkAdd(
        actor: ScopeActor,
        groupId: number,
        dto: BulkMembersDto,
    ): Promise<BulkMembersResultDto> {
        // Defensive belt-and-suspenders — controller carries @Roles('admin'); RolesGuard
        // rejects before this service runs. Reaching here means actor.role_name === 'admin'.
        if (actor.role_name !== 'admin') {
            throw new ForbiddenException('groups.members.forbidden');
        }
        await this.assertScope(actor, groupId);

        const bulk_op_id =
            dto.bulk_op_id && /^[0-9a-fA-F-]{36}$/.test(dto.bulk_op_id) ? dto.bulk_op_id : randomUUID();
        const userIds = Array.from(new Set(dto.user_ids));

        // Resolve target users: must exist + not deleted. Out-of-existence -> error row.
        const users = await this.prisma.user.findMany({
            where: { id: { in: userIds }, deleted_at: null },
            select: { id: true },
        });
        const allowedIds = new Set<number>((users as Array<{ id: number }>).map((u) => Number(u.id)));

        // Existing GroupUser rows for this group + these users -> skip duplicates.
        const existing = await this.prisma.groupUser.findMany({
            where: { group_id: groupId, user_id: { in: userIds } },
            select: { user_id: true },
        });
        const existingSet = new Set<number>(
            (existing as Array<{ user_id: number }>).map((e) => Number(e.user_id)),
        );

        // Classify rows.
        const rows: BulkMembersResultRowDto[] = userIds.map((uid) => {
            if (!allowedIds.has(uid)) {
                return { row_id: String(uid), status: 'error', reason: 'user_not_found', user_id: uid };
            }
            if (existingSet.has(uid)) {
                return { row_id: String(uid), status: 'skip', reason: 'already_member', user_id: uid };
            }
            return { row_id: String(uid), status: 'insert', reason: null, user_id: uid };
        });

        const insertList = rows.filter((r) => r.status === 'insert').map((r) => r.user_id);
        const affected = insertList.length;

        // Server-side confirmation gate (T-04-32) — independent of UI.
        if (dto.mode === 'commit' && affected > GroupsMembersService.CONFIRM_THRESHOLD) {
            if (typeof dto.confirmed_count !== 'number' || dto.confirmed_count !== affected) {
                throw new BadRequestException(
                    `confirmation_required:expected_${affected}_got_${dto.confirmed_count ?? 'null'}`,
                );
            }
        }

        // Commit path — chunked $transaction (T-04-33).
        if (dto.mode === 'commit' && insertList.length > 0) {
            const now = Math.floor(Date.now() / 1000);
            for (let i = 0; i < insertList.length; i += GroupsMembersService.TX_CHUNK_SIZE) {
                const chunk = insertList.slice(i, i + GroupsMembersService.TX_CHUNK_SIZE);
                // Individual create() inside $transaction (NOT createMany) — schema lacks
                // @@unique([user_id, group_id]) so createMany skipDuplicates is a no-op.
                // The findMany existence-probe above already filtered duplicates.
                await this.prisma.$transaction(
                    chunk.map((uid) =>
                        this.prisma.groupUser.create({
                            data: { group_id: groupId, user_id: uid, created_at: now },
                        }),
                    ),
                );
            }
            this.logger.log(
                `groups.members.add committed bulk_op_id=${bulk_op_id} actor=${actor.id} ` +
                    `group=${groupId} affected=${affected}`,
            );
        }

        return {
            bulk_op_id,
            mode: dto.mode,
            affected,
            insert: affected,
            remove: 0,
            skip: rows.filter((r) => r.status === 'skip').length,
            error: rows.filter((r) => r.status === 'error').length,
            rows,
        };
    }

    public async bulkRemove(
        actor: ScopeActor,
        groupId: number,
        dto: BulkMembersDto,
    ): Promise<BulkMembersResultDto> {
        if (actor.role_name !== 'admin') {
            throw new ForbiddenException('groups.members.forbidden');
        }
        await this.assertScope(actor, groupId);

        const bulk_op_id =
            dto.bulk_op_id && /^[0-9a-fA-F-]{36}$/.test(dto.bulk_op_id) ? dto.bulk_op_id : randomUUID();
        const userIds = Array.from(new Set(dto.user_ids));

        // Find existing GroupUser rows for this group + these users -> remove only those.
        const existing = await this.prisma.groupUser.findMany({
            where: { group_id: groupId, user_id: { in: userIds } },
            select: { user_id: true },
        });
        const existingSet = new Set<number>(
            (existing as Array<{ user_id: number }>).map((e) => Number(e.user_id)),
        );

        const rows: BulkMembersResultRowDto[] = userIds.map((uid) => {
            if (!existingSet.has(uid)) {
                return { row_id: String(uid), status: 'skip', reason: 'not_a_member', user_id: uid };
            }
            return { row_id: String(uid), status: 'remove', reason: null, user_id: uid };
        });

        const removeList = rows.filter((r) => r.status === 'remove').map((r) => r.user_id);
        const affected = removeList.length;

        if (dto.mode === 'commit' && affected > GroupsMembersService.CONFIRM_THRESHOLD) {
            if (typeof dto.confirmed_count !== 'number' || dto.confirmed_count !== affected) {
                throw new BadRequestException(
                    `confirmation_required:expected_${affected}_got_${dto.confirmed_count ?? 'null'}`,
                );
            }
        }

        if (dto.mode === 'commit' && removeList.length > 0) {
            // deleteMany is idempotent under WHERE; chunked for safety even though MySQL
            // handles large IN() lists fine — keeps statement size bounded.
            for (let i = 0; i < removeList.length; i += GroupsMembersService.TX_CHUNK_SIZE) {
                const chunk = removeList.slice(i, i + GroupsMembersService.TX_CHUNK_SIZE);
                await this.prisma.groupUser.deleteMany({
                    where: { group_id: groupId, user_id: { in: chunk } },
                });
            }
            this.logger.log(
                `groups.members.remove committed bulk_op_id=${bulk_op_id} actor=${actor.id} ` +
                    `group=${groupId} affected=${affected}`,
            );
        }

        return {
            bulk_op_id,
            mode: dto.mode,
            affected,
            insert: 0,
            remove: affected,
            skip: rows.filter((r) => r.status === 'skip').length,
            error: 0,
            rows,
        };
    }

    public async progress(
        actor: ScopeActor,
        groupId: number,
        dto: MemberProgressRequestDto,
    ): Promise<MemberProgressResponseDto> {
        await this.assertScope(actor, groupId);

        const userIds = Array.from(new Set(dto.user_ids));
        if (userIds.length === 0) return { rows: [] };

        // courses_started: distinct webinar_id from Sale (refund_at IS NULL).
        // Refunded rows do NOT count toward "started" — same posture as Phase 3 Plan 05.
        const startedRaw = await this.prisma.sale.findMany({
            where: {
                buyer_id: { in: userIds },
                webinar_id: { not: null },
                refund_at: null,
            },
            select: { buyer_id: true, webinar_id: true },
        });
        const startedMap = new Map<number, Set<number>>();
        for (const s of startedRaw as Array<{ buyer_id: number; webinar_id: number | null }>) {
            if (s.webinar_id == null) continue;
            const uid = Number(s.buyer_id);
            const set = startedMap.get(uid) ?? new Set<number>();
            set.add(Number(s.webinar_id));
            startedMap.set(uid, set);
        }

        // courses_completed: distinct item_id from RewardAccounting type='learning_progress_100'.
        // The string literal matches the RewardType enum value generated by Prisma; passing
        // it as a raw string is accepted (Prisma serializes to the enum at the protocol layer).
        const completedRaw = await this.prisma.rewardAccounting.findMany({
            where: {
                user_id: { in: userIds },
                type: 'learning_progress_100' as any,
            },
            select: { user_id: true, item_id: true },
        });
        const completedMap = new Map<number, Set<number>>();
        for (const r of completedRaw as Array<{ user_id: number; item_id: number | null }>) {
            if (r.item_id == null) continue;
            const uid = Number(r.user_id);
            const set = completedMap.get(uid) ?? new Set<number>();
            set.add(Number(r.item_id));
            completedMap.set(uid, set);
        }

        const rows: MemberProgressRowDto[] = userIds.map((uid) => ({
            user_id: uid,
            courses_started: startedMap.get(uid)?.size ?? 0,
            courses_completed: completedMap.get(uid)?.size ?? 0,
        }));

        return { rows };
    }
}
