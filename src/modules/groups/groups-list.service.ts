import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { buildScopeWhere } from '../../common/scoping/scope.helper';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { ListGroupsDto } from './dto/list-groups.dto';
import type { GroupListResponseDto, GroupRowDto } from './dto/group-row.dto';
import { GROUP_SCOPE_RULES } from './groups.scope';

/**
 * GRP-01 — paginated, scoped, filtered, search-able groups list (Plan 02).
 *
 * Diff vs Phase 3 UsersListService:
 *   - Group has NO `deleted_at` column (Plan 01 schema-gap note) — no `deleted_at: null` filter.
 *   - Group has NO `created_at` column — sort by created_at maps to `{ id: order }`
 *     (autoincrement monotonic; safe proxy). GroupRowDto.created_at is ALWAYS null.
 *   - `member_count_bucket` is implemented as:
 *       - 'zero'                  -> Prisma `where: { members: { none: {} } }`
 *       - 'small' / 'medium' / 'large' -> Prisma `where: { members: { some: {} } }`
 *         (excludes zero-member groups) PLUS post-fetch filter on the page result for the
 *         numeric range. Trade-off: the unfiltered `total` may exceed the in-memory
 *         filtered `rows.length`. Documented per Plan 02 task 1 action note. Prisma 6
 *         lacks a `_count` predicate, so a fully server-side numeric-range filter would
 *         require a raw SQL HAVING clause. Acceptable given the bucket is a coarse hint.
 *   - `sort: 'member_count'` cannot be expressed as Prisma `orderBy` (no _count orderBy on
 *     mysql provider). Implemented as in-memory page reorder. Same trade-off as above.
 *
 * Scope (D-18): admin sees all (rules omitted -> {}); curator narrows to
 * `supervisor_id === actor.id`; teacher gets `id: { in: [] }` -> empty result.
 *
 * Performance: explicit `select` (NOT `include`); `_count.members` computed inline so
 * no N+1. Uses `prisma.$transaction([count, findMany])` like Phase 3 list endpoint.
 */
@Injectable()
export class GroupsListService {
    private readonly logger = new Logger(GroupsListService.name);

    public static readonly DEFAULT_PAGE_SIZE = 50;
    public static readonly MAX_PAGE_SIZE = 200;

    constructor(private readonly prisma: PrismaService) {}

    public async list(actor: ScopeActor, query: ListGroupsDto): Promise<GroupListResponseDto> {
        const page = Math.max(1, query.page ?? 1);
        const page_size = Math.min(
            GroupsListService.MAX_PAGE_SIZE,
            Math.max(1, query.page_size ?? GroupsListService.DEFAULT_PAGE_SIZE),
        );
        const sort = query.sort ?? 'created_at';
        const order: 'asc' | 'desc' = query.order ?? 'desc';

        // Filter where (status / supervisor_id / search / member_count_bucket).
        const filterWhere: any = {};
        if (query.status) filterWhere.status = query.status;
        if (typeof query.supervisor_id === 'number') filterWhere.supervisor_id = query.supervisor_id;
        if (query.q && query.q.trim().length > 0) {
            // MySQL utf8mb4_general_ci handles case-insensitivity for `contains` automatically;
            // Prisma `mode: 'insensitive'` is Postgres-only.
            filterWhere.name = { contains: query.q.trim() };
        }

        // Member-count bucket: server-side narrowing for 'zero' (none) vs non-zero (some).
        // Size-bucket numeric ranges (small/medium/large) are filtered post-fetch — see header.
        if (query.member_count_bucket === 'zero') {
            filterWhere.members = { none: {} };
        } else if (query.member_count_bucket) {
            filterWhere.members = { some: {} };
        }

        const scopeWhere = buildScopeWhere(actor, GROUP_SCOPE_RULES);
        const where: any = { ...filterWhere, ...(scopeWhere as object) };

        // Cursor pagination: when cursor present, override offset; offset becomes 0.
        let cursorClause: any = undefined;
        let skip = (page - 1) * page_size;
        if (query.cursor) {
            const last = Number(query.cursor);
            if (Number.isFinite(last) && last > 0) {
                cursorClause = order === 'desc' ? { id: { lt: last } } : { id: { gt: last } };
                skip = 0;
            }
        }
        const finalWhere = cursorClause ? { AND: [where, cursorClause] } : where;

        // created_at -> id (schema gap). member_count -> id then in-memory reorder of the page.
        const orderBy: any = sort === 'name' ? { name: order } : { id: order };

        const [total, rows] = await this.prisma.$transaction([
            this.prisma.group.count({ where: finalWhere }),
            this.prisma.group.findMany({
                where: finalWhere,
                select: {
                    id: true,
                    name: true,
                    status: true,
                    supervisor: { select: { id: true, full_name: true } },
                    _count: { select: { members: true } },
                },
                // Tie-breaker on id so cursor pagination is deterministic when sort field has ties.
                orderBy: [orderBy, { id: order }],
                take: page_size,
                skip,
            }),
        ]);

        // Post-fetch: numeric-range bucket filter (small/medium/large) + member_count sort.
        let pageRows: any[] = rows as any[];
        if (query.member_count_bucket && query.member_count_bucket !== 'zero') {
            const filterFn =
                query.member_count_bucket === 'small'
                    ? (n: number) => n >= 1 && n <= 25
                    : query.member_count_bucket === 'medium'
                    ? (n: number) => n >= 26 && n <= 50
                    : (n: number) => n >= 51;
            pageRows = pageRows.filter((r: any) => filterFn(r._count?.members ?? 0));
        }
        if (sort === 'member_count') {
            pageRows = [...pageRows].sort((a: any, b: any) => {
                const av = a._count?.members ?? 0;
                const bv = b._count?.members ?? 0;
                return order === 'asc' ? av - bv : bv - av;
            });
        }

        const out: GroupRowDto[] = pageRows.map((r: any) => ({
            id: Number(r.id),
            name: r.name,
            status: r.status,
            supervisor: r.supervisor
                ? { id: Number(r.supervisor.id), full_name: r.supervisor.full_name ?? null }
                : null,
            member_count: r._count?.members ?? 0,
            created_at: null, // schema gap — Group has no created_at column
        }));

        const next_cursor = out.length === page_size ? String(out[out.length - 1].id) : null;

        return { rows: out, total, page, page_size, next_cursor };
    }
}
