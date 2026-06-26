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
import type { ResolveMembersDto, ResolveMembersResultDto, ResolveResultRowDto, StudentCandidateDto } from './dto/resolve-members.dto';

/** A learner row selected for resolution/matching (subset of User columns). */
type ResolveLearner = {
    id: number;
    full_name: string | null;
    mobile: string | null;
    email: string | null;
    status: any;
};

/** Collapse internal whitespace + trim. Returns '' for nullish/empty input. */
function collapseName(input: string | null | undefined): string {
    if (!input) return '';
    return String(input).replace(/\s+/g, ' ').trim();
}

/** Lower-cased collapsed form — the comparison key for case/space-insensitive name matching. */
function nameKey(input: string | null | undefined): string {
    return collapseName(input).toLowerCase();
}

/**
 * Forward + reversed-word-order variants of a collapsed name. KZ users enter
 * "Имя Фамилия" but the stored full_name may be "Фамилия Имя" — we try both.
 */
function nameVariants(collapsed: string): string[] {
    if (!collapsed) return [];
    const words = collapsed.split(' ');
    if (words.length < 2) return [collapsed];
    const reversed = [...words].reverse().join(' ');
    return reversed === collapsed ? [collapsed] : [collapsed, reversed];
}

/**
 * Last 10 digits (national significant number) of any phone-ish string. Handles
 * `+77...`, `77...`, `87...`, and bare 10-digit forms by stripping non-digits.
 * Returns null when fewer than 10 digits are present (treated as "no phone").
 */
function phoneNsn(input: string | null | undefined): string | null {
    if (!input) return null;
    const digits = String(input).replace(/\D/g, '');
    if (digits.length < 10) return null;
    return digits.slice(-10);
}

/**
 * Candidate stored representations for an NSN, for an index-friendly `mobile IN (...)`.
 * Covers the documented mixed storage formats (`+77072852362` vs `77072852362`) plus
 * the legacy `8...` and bare-10 forms.
 */
function phoneStorageVariants(nsn: string): string[] {
    return [`+7${nsn}`, `7${nsn}`, `8${nsn}`, nsn];
}

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
 *   2. own-supervisor scope check         -> 403 only for foreign-curator (per-tenant
 *                                            narrowing); teacher/other governed by grant
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
        // admin always passes; curator must own the group (per-tenant narrowing);
        // teacher (and any other admitted role) is governed by @RequirePermission — no
        // per-tenant row narrowing applies, so they are allowed once the grant admits them.
        if (actor.role_name === 'curator' && Number(exists.supervisor_id ?? 0) !== actor.id) {
            throw new ForbiddenException('groups.forbidden_scope');
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
        // Access is governed by @Roles + @RequirePermission('groups.edit') at the controller;
        // assertScope keeps curator's per-tenant own-group narrowing.
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
        // Access is governed by @Roles + @RequirePermission('groups.edit') at the controller;
        // assertScope keeps curator's per-tenant own-group narrowing.
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

    /**
     * GRP-07 — Excel bulk-import resolution (matching only; no mutation).
     *
     * Matches each imported { name?, phone? } row against existing learners
     * (role_name='user', not deleted) and returns candidates + their group
     * membership. The admin-client then commits the chosen user_ids through the
     * existing bulkAdd path (POST /:id/members), so this method NEVER writes.
     *
     * Strategy — 3 batch queries regardless of row count:
     *   1. user.findMany by phone storage-variants  (phone is the authoritative key)
     *   2. user.findMany by exact name (collation = case-insensitive) + reversed order
     *   3. groupUser.findMany for every candidate user -> membership badges
     *
     * Phone precedence: when a row has both fields and the phone resolves a user, we
     * match by phone and flag `name_mismatch` if the supplied name disagrees (rather
     * than rejecting). Rows with neither field -> status='invalid'.
     */
    public async resolveMembers(
        actor: ScopeActor,
        groupId: number,
        dto: ResolveMembersDto,
    ): Promise<ResolveMembersResultDto> {
        await this.assertScope(actor, groupId);

        // Per-row normalization.
        const prepared = dto.rows.map((r, index) => {
            const collapsedName = collapseName(r.name);
            const nsn = phoneNsn(r.phone);
            return {
                index,
                inputName: collapsedName || null,
                inputPhone: (r.phone ?? '').trim() || null,
                collapsedName,
                nsn,
                hasName: collapsedName.length > 0,
                hasPhone: nsn !== null,
            };
        });

        // Collect distinct phone variants + name candidates across all rows.
        const phoneVariantSet = new Set<string>();
        const nameQuerySet = new Set<string>();
        for (const p of prepared) {
            if (p.hasPhone && p.nsn) for (const v of phoneStorageVariants(p.nsn)) phoneVariantSet.add(v);
            if (p.hasName) for (const v of nameVariants(p.collapsedName)) nameQuerySet.add(v);
        }

        // Batch query 1 — learners matched by phone. mobileMap is keyed by NSN so both
        // `+77...` and `77...` stored forms collapse to the same lookup key.
        const phoneUsers: ResolveLearner[] = phoneVariantSet.size
            ? await this.prisma.user.findMany({
                  where: { role_name: 'user', deleted_at: null, mobile: { in: Array.from(phoneVariantSet) } },
                  select: { id: true, full_name: true, mobile: true, email: true, status: true },
              })
            : [];
        const mobileMap = new Map<string, ResolveLearner>();
        for (const u of phoneUsers) {
            const key = phoneNsn(u.mobile);
            if (key && !mobileMap.has(key)) mobileMap.set(key, u);
        }

        // Batch query 2 — learners matched by exact name (MySQL utf8mb4_general_ci makes
        // the IN() comparison case-insensitive; whitespace must already be collapsed).
        const nameUsers: ResolveLearner[] = nameQuerySet.size
            ? await this.prisma.user.findMany({
                  where: { role_name: 'user', deleted_at: null, full_name: { in: Array.from(nameQuerySet) } },
                  select: { id: true, full_name: true, mobile: true, email: true, status: true },
              })
            : [];
        const nameMap = new Map<string, ResolveLearner[]>();
        for (const u of nameUsers) {
            const key = nameKey(u.full_name);
            if (!key) continue;
            const arr = nameMap.get(key) ?? [];
            arr.push(u);
            nameMap.set(key, arr);
        }

        // Resolve per-row candidate list (phone takes precedence over name).
        const candidateUsers = new Map<number, ResolveLearner>();
        const rowCandidates: ResolveLearner[][] = prepared.map((p) => {
            if (p.hasPhone && p.nsn) {
                const u = mobileMap.get(p.nsn);
                if (u) {
                    candidateUsers.set(Number(u.id), u);
                    return [u];
                }
            }
            if (p.hasName) {
                const keys = nameVariants(p.collapsedName).map((v) => nameKey(v));
                const seen = new Set<number>();
                const list: ResolveLearner[] = [];
                for (const k of keys) {
                    for (const u of nameMap.get(k) ?? []) {
                        const uid = Number(u.id);
                        if (!seen.has(uid)) {
                            seen.add(uid);
                            list.push(u);
                            candidateUsers.set(uid, u);
                        }
                    }
                }
                return list.slice(0, 25); // cap per-row ambiguity payload
            }
            return [];
        });

        // Batch query 3 — group memberships for every candidate (for the badges).
        const candidateIds = Array.from(candidateUsers.keys());
        const memberships = candidateIds.length
            ? await this.prisma.groupUser.findMany({
                  where: { user_id: { in: candidateIds } },
                  select: { user_id: true, group: { select: { id: true, name: true } } },
              })
            : [];
        const groupsByUser = new Map<number, Array<{ id: number; name: string }>>();
        for (const m of memberships as Array<{ user_id: number; group: { id: number; name: string } | null }>) {
            if (!m.group) continue;
            const uid = Number(m.user_id);
            const arr = groupsByUser.get(uid) ?? [];
            arr.push({ id: Number(m.group.id), name: m.group.name });
            groupsByUser.set(uid, arr);
        }

        const toCandidate = (u: ResolveLearner): StudentCandidateDto => {
            const groups = groupsByUser.get(Number(u.id)) ?? [];
            return {
                user_id: Number(u.id),
                full_name: u.full_name ?? null,
                mobile: u.mobile ?? null,
                email: u.email ?? null,
                status: u.status,
                in_this_group: groups.some((g) => g.id === groupId),
                groups,
            };
        };

        const nameMatchesUser = (collapsedName: string, full_name: string | null): boolean =>
            nameVariants(collapsedName).some((v) => nameKey(v) === nameKey(full_name));

        // Classify each row. matchedSeen tracks first-seen matched users for dup flagging.
        const matchedSeen = new Set<number>();
        const rows: ResolveResultRowDto[] = prepared.map((p, i) => {
            const base = {
                index: p.index,
                input: { name: p.inputName, phone: p.inputPhone },
                matched_user_id: null as number | null,
                name_mismatch: false,
                duplicate_in_file: false,
                candidates: [] as StudentCandidateDto[],
            };

            if (!p.hasName && !p.hasPhone) {
                return { ...base, status: 'invalid' };
            }

            // Phone match (authoritative).
            if (p.hasPhone && p.nsn && mobileMap.get(p.nsn)) {
                const u = mobileMap.get(p.nsn)!;
                const uid = Number(u.id);
                const name_mismatch = p.hasName ? !nameMatchesUser(p.collapsedName, u.full_name) : false;
                const duplicate_in_file = matchedSeen.has(uid);
                matchedSeen.add(uid);
                return {
                    ...base,
                    status: 'matched',
                    matched_user_id: uid,
                    name_mismatch,
                    duplicate_in_file,
                    candidates: [toCandidate(u)],
                };
            }

            // Name match fallback.
            const cands = rowCandidates[i];
            if (cands.length === 1) {
                const uid = Number(cands[0].id);
                const duplicate_in_file = matchedSeen.has(uid);
                matchedSeen.add(uid);
                return {
                    ...base,
                    status: 'matched',
                    matched_user_id: uid,
                    duplicate_in_file,
                    candidates: [toCandidate(cands[0])],
                };
            }
            if (cands.length > 1) {
                return { ...base, status: 'ambiguous', candidates: cands.map(toCandidate) };
            }
            return { ...base, status: 'unmatched' };
        });

        return { rows };
    }
}
