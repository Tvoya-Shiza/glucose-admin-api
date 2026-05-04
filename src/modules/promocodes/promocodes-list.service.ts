import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { buildScopeWhere } from '../../common/scoping/scope.helper';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { ListPromocodesDto } from './dto/list-promocodes.dto';
import { PROMOCODE_SCOPE_RULES } from './promocodes.scope';

/**
 * PRM-01 — paginated, scoped, filtered, search-able promocodes list (Plan 05).
 *
 * Schema-truth posture (Plan 01 lock):
 *   - Promocode.discount_value Decimal(10,2) → string via `.toFixed(2)` at egress
 *     (BigInt-as-string posture extends to Decimal per CLAUDE.md).
 *   - Promocode.code @unique varchar — search OR(code, title) `contains`.
 *   - Promocode.start_date / expires_at unsigned int unix seconds → status_window
 *     filter computed against `Math.floor(Date.now() / 1000)`.
 *   - sort=usage_count → Prisma orderBy `{ usages: { _count: <order> } }`.
 *   - Promocode.id is `Int` (signed, NOT @db.UnsignedInt).
 *
 * Scope (D-20):
 *   - admin   -> rule omitted -> {} -> sees all
 *   - teacher -> { id: { in: [] } } -> empty result
 *   - curator -> { id: { in: [] } } -> empty result
 *
 * Response shape: raw `{ rows, total, pageCount }` (CLAUDE.md — list endpoints don't
 * wrap with apiResponse; admin-client TanStack Table consumes the raw shape).
 */
export interface PromocodeListRow {
    id: number;
    code: string;
    title: string | null;
    discount_type: 'percentage' | 'fixed';
    discount_value: string;
    is_active: boolean;
    start_date: number;
    expires_at: number;
    usage_limit: number | null;
    usage_count: number;
    created_at: number;
}

export interface PromocodeListResponse {
    rows: PromocodeListRow[];
    total: number;
    pageCount: number;
}

function decimalToString(value: unknown): string {
    if (value === null || value === undefined) return '0.00';
    if (typeof (value as { toFixed?: unknown }).toFixed === 'function') {
        return (value as { toFixed: (n: number) => string }).toFixed(2);
    }
    return String(value);
}

@Injectable()
export class PromocodesListService {
    private readonly logger = new Logger(PromocodesListService.name);

    public static readonly DEFAULT_PAGE_SIZE = 50;
    public static readonly MAX_PAGE_SIZE = 200;

    constructor(private readonly prisma: PrismaService) {}

    public async list(actor: ScopeActor, query: ListPromocodesDto): Promise<PromocodeListResponse> {
        const page = Math.max(1, query.page ?? 1);
        const page_size = Math.min(
            PromocodesListService.MAX_PAGE_SIZE,
            Math.max(1, query.page_size ?? PromocodesListService.DEFAULT_PAGE_SIZE),
        );
        const sort = query.sort ?? 'created_at';
        const order: 'asc' | 'desc' = query.order ?? 'desc';
        const now = Math.floor(Date.now() / 1000);

        // Filter where (status / discount_type / is_active / status_window / q).
        const filterWhere: any = {};
        if (query.discount_type) filterWhere.discount_type = query.discount_type;
        if (typeof query.is_active === 'boolean') filterWhere.is_active = query.is_active;

        if (query.q && query.q.trim().length > 0) {
            const needle = query.q.trim();
            filterWhere.OR = [
                { code: { contains: needle } },
                { title: { contains: needle } },
            ];
        }

        // status_window — computed window over start_date / expires_at.
        if (query.status_window === 'active') {
            filterWhere.start_date = { lte: now };
            filterWhere.expires_at = { gte: now };
            filterWhere.is_active = true;
        } else if (query.status_window === 'expired') {
            filterWhere.expires_at = { lt: now };
        } else if (query.status_window === 'future') {
            filterWhere.start_date = { gt: now };
        }
        // 'all' or undefined → no window filter.

        // Scope spread (admin sees all; non-admin -> empty).
        const scopeWhere = buildScopeWhere(actor, PROMOCODE_SCOPE_RULES);
        const where: any = { ...filterWhere, ...(scopeWhere as object) };

        // orderBy
        let orderBy: any;
        if (sort === 'usage_count') {
            orderBy = { usages: { _count: order } };
        } else if (sort === 'expires_at') {
            orderBy = { expires_at: order };
        } else {
            orderBy = { created_at: order };
        }

        const skip = (page - 1) * page_size;

        const [total, rows] = await this.prisma.$transaction([
            this.prisma.promocode.count({ where }),
            this.prisma.promocode.findMany({
                where,
                include: { _count: { select: { usages: true } } },
                orderBy: [orderBy, { id: order }],
                take: page_size,
                skip,
            }),
        ]);

        const out: PromocodeListRow[] = (rows as any[]).map((p: any) => ({
            id: Number(p.id),
            code: String(p.code),
            title: p.title ?? null,
            discount_type: p.discount_type as 'percentage' | 'fixed',
            discount_value: decimalToString(p.discount_value),
            is_active: !!p.is_active,
            start_date: Number(p.start_date),
            expires_at: Number(p.expires_at),
            usage_limit: p.usage_limit ?? null,
            usage_count: Number(p._count?.usages ?? 0),
            created_at: Number(p.created_at),
        }));

        return {
            rows: out,
            total: Number(total),
            pageCount: Math.max(1, Math.ceil(Number(total) / page_size)),
        };
    }
}
