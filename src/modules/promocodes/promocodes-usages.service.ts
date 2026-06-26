import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { buildScopeWhere } from '../../common/scoping/scope.helper';
import { ListUsagesDto } from './dto/list-usages.dto';
import { PROMOCODE_SCOPE_RULES } from './promocodes.scope';
import { PromocodesCacheService } from './utils/promocodes-cache.service';
import { PROMOCODES_USAGES_PREFIX } from './utils/promocodes-cache';

/**
 * PRM-02 — promocode usage list (Plan 05).
 *
 * Returns paginated PromocodeUsage rows joined to User (full_name + email) and the
 * Order id reference. Decimal fields (`discount_amount`, `order_amount`) are
 * NULLABLE on the schema (Plan 01 schema-truth lock #7) and serialize to
 * `string | null` via `.toFixed(2)`.
 *
 * Scope: runtime-RBAC-driven. The parent Promocode existence check spreads
 * PROMOCODE_SCOPE_RULES, which narrows no role by row -> {} -> any role granted
 * @RequirePermission('promocodes.view') sees the promocode (404 only if it truly
 * doesn't exist).
 *
 * Response shape: raw `{ rows, total, pageCount }` (CLAUDE.md — list endpoints
 * don't wrap with apiResponse).
 */
export interface PromocodeUsageListRow {
    id: number;
    promocode_id: number;
    user_id: number;
    user_full_name: string | null;
    user_email: string | null;
    order_id: number;
    discount_amount: string | null;
    order_amount: string | null;
    used_at: number;
}

export interface PromocodeUsageListResponse {
    rows: PromocodeUsageListRow[];
    total: number;
    pageCount: number;
}

function decimalToStringOrNull(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (typeof (value as { toFixed?: unknown }).toFixed === 'function') {
        return (value as { toFixed: (n: number) => string }).toFixed(2);
    }
    return String(value);
}

@Injectable()
export class PromocodesUsagesService {
    private readonly logger = new Logger(PromocodesUsagesService.name);

    public static readonly DEFAULT_PAGE_SIZE = 50;
    public static readonly MAX_PAGE_SIZE = 200;

    constructor(
        private readonly prisma: PrismaService,
        private readonly cache: PromocodesCacheService,
    ) {}

    public async list(
        actor: ScopeActor,
        promocodeId: number,
        query: ListUsagesDto,
    ): Promise<PromocodeUsageListResponse> {
        // Parent Promocode existence + scope check. buildScopeWhere is spread into
        // findFirst: no role narrows by row -> {} -> any granted role sees it (404 only
        // when the promocode truly doesn't exist). Mirrors the list endpoints.
        const promocode: any = await this.prisma.promocode.findFirst({
            where: { id: promocodeId, ...(buildScopeWhere(actor, PROMOCODE_SCOPE_RULES) as object) },
            select: { id: true },
        });
        if (!promocode) throw new NotFoundException('promocodes.not_found');

        const page = Math.max(1, query.page ?? 1);
        const page_size = Math.min(
            PromocodesUsagesService.MAX_PAGE_SIZE,
            Math.max(1, query.page_size ?? PromocodesUsagesService.DEFAULT_PAGE_SIZE),
        );
        const order: 'asc' | 'desc' = query.order ?? 'desc';

        const fingerprint = JSON.stringify({ page, page_size, order });
        const cacheKey = `${PROMOCODES_USAGES_PREFIX}:${promocodeId}:${fingerprint}`;

        return this.cache.getOrSet(cacheKey, () => this.fetchUsages(promocodeId, page, page_size, order));
    }

    private async fetchUsages(
        promocodeId: number,
        page: number,
        page_size: number,
        order: 'asc' | 'desc',
    ): Promise<PromocodeUsageListResponse> {
        const skip = (page - 1) * page_size;
        const where: any = { promocode_id: promocodeId };
        const orderBy: any = { used_at: order };

        const [total, rows] = await this.prisma.$transaction([
            this.prisma.promocodeUsage.count({ where }),
            this.prisma.promocodeUsage.findMany({
                where,
                include: {
                    user: { select: { id: true, full_name: true, email: true } },
                },
                orderBy: [orderBy, { id: order }],
                take: page_size,
                skip,
            }),
        ]);

        const out: PromocodeUsageListRow[] = (rows as any[]).map((r: any) => ({
            id: Number(r.id),
            promocode_id: Number(r.promocode_id),
            user_id: Number(r.user_id),
            user_full_name: r.user?.full_name ?? null,
            user_email: r.user?.email ?? null,
            order_id: Number(r.order_id),
            discount_amount: decimalToStringOrNull(r.discount_amount),
            order_amount: decimalToStringOrNull(r.order_amount),
            used_at: Number(r.used_at),
        }));

        return {
            rows: out,
            total: Number(total),
            pageCount: Math.max(1, Math.ceil(Number(total) / page_size)),
        };
    }
}
