import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { buildScopeWhere } from '../../common/scoping/scope.helper';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { ListUsersDto } from './dto/list-users.dto';
import type { UserListResponseDto, UserRowDto } from './dto/user-row.dto';
import { USER_SCOPE_RULES } from './users.scope';
import { normalizeKzPhone } from './utils/normalize-phone';

/**
 * USR-01 — paginated, scoped, filtered, search-able users list (Plan 02).
 *
 * Hybrid pagination (D-03):
 *   - cursor present  -> WHERE id <op> cursor; skip = 0
 *   - cursor absent   -> standard offset (page-1) * page_size
 *
 * Scope (D-21): admin sees all; curator narrows via group supervisor; teacher narrows via
 * sales_as_buyer.webinar.teacher_id. Spread `buildScopeWhere(actor, USER_SCOPE_RULES)` into
 * the where clause — forgetting it leaks data (T-03-11). Default-deny in scope.helper means
 * unknown roles get `id: { in: [] }` injected, returning zero rows.
 *
 * Performance (D-07): explicit Prisma `select` (NOT `include`) so password is NEVER projected
 * (T-03-10). `last_activity` is `DateTime?` in schema -> Unix seconds at the boundary so the
 * wire format is consistent with `created_at` (Int). MySQL's utf8mb4_general_ci handles
 * case-insensitivity for `contains` automatically — Prisma's `mode: 'insensitive'` is
 * Postgres-only and would type-error against the MySQL client.
 */
@Injectable()
export class UsersListService {
    private readonly logger = new Logger(UsersListService.name);

    public static readonly DEFAULT_PAGE_SIZE = 50;
    public static readonly MAX_PAGE_SIZE = 200;

    constructor(private readonly prisma: PrismaService) {}

    public async list(actor: ScopeActor, query: ListUsersDto): Promise<UserListResponseDto> {
        const page = Math.max(1, query.page ?? 1);
        const page_size = Math.min(
            UsersListService.MAX_PAGE_SIZE,
            Math.max(1, query.page_size ?? UsersListService.DEFAULT_PAGE_SIZE),
        );
        const sort = query.sort ?? 'created_at';
        const order: 'asc' | 'desc' = query.order ?? 'desc';

        // Filter where (role / status / region / search) — kept separate so we can compose
        // it with the scope fragment + cursor clause below without losing precedence.
        const filterWhere: any = {};
        if (query.role_name) filterWhere.role_name = query.role_name;
        if (query.status) filterWhere.status = query.status;
        if (typeof query.region_id === 'number') {
            filterWhere.OR = [
                { city_id: query.region_id },
                { province_id: query.region_id },
                { country_id: query.region_id },
                { school_id: query.region_id },
            ];
        }
        if (query.q && query.q.trim().length > 0) {
            const raw = query.q.trim();
            // If the query looks like a KZ phone, search the normalized form against `mobile`
            // (which is stored canonical +7XXXXXXXXXX). Otherwise fall back to literal contains
            // so partial matches like '7012' still hit (T-03-14 mitigation: bounded by page_size).
            const phoneNorm = normalizeKzPhone(raw);
            const search: any[] = [
                { full_name: { contains: raw } },
                { email: { contains: raw } },
                { mobile: { contains: phoneNorm ?? raw } },
            ];
            if (filterWhere.OR) {
                // region_id already produced an OR — combine via AND so both predicates apply.
                filterWhere.AND = [{ OR: filterWhere.OR }, { OR: search }];
                delete filterWhere.OR;
            } else {
                filterWhere.OR = search;
            }
        }

        const scopeWhere = buildScopeWhere(actor, USER_SCOPE_RULES);
        // deleted_at filter: User.deleted_at is `Int?` (Unix seconds), not DateTime. `null` is
        // still the right sentinel for "not soft-deleted" — out-of-scope undelete UI per CONTEXT.
        const where: any = { ...filterWhere, ...scopeWhere, deleted_at: null };

        // Cursor pagination (when cursor present) overrides offset; offset becomes 0.
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

        const orderBy: any =
            sort === 'full_name'
                ? { full_name: order }
                : sort === 'last_activity'
                ? { last_activity: order }
                : { created_at: order };

        // 1+1 query: count + page rows. _count.group_users is computed inline (no N+1).
        const [total, rows] = await this.prisma.$transaction([
            this.prisma.user.count({ where: finalWhere }),
            this.prisma.user.findMany({
                where: finalWhere,
                select: {
                    id: true,
                    full_name: true,
                    email: true,
                    mobile: true,
                    role_id: true,
                    role_name: true,
                    status: true,
                    last_activity: true,
                    created_at: true,
                    _count: { select: { group_users: true } },
                },
                // Tie-breaker on id so cursor pagination is deterministic when sort field has ties.
                orderBy: [orderBy, { id: order }],
                take: page_size,
                skip,
            }),
        ]);

        const out: UserRowDto[] = rows.map((r: any) => ({
            id: Number(r.id),
            full_name: r.full_name ?? null,
            email: r.email ?? null,
            mobile: r.mobile ?? null,
            role_id: Number(r.role_id),
            role_name: r.role_name,
            status: r.status,
            group_count: r._count?.group_users ?? 0,
            last_activity: r.last_activity ? Math.floor(new Date(r.last_activity).getTime() / 1000) : null,
            created_at: Number(r.created_at),
        }));

        const next_cursor = out.length === page_size ? String(out[out.length - 1].id) : null;

        return { rows: out, total, page, page_size, next_cursor };
    }
}
