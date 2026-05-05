import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from 'generated/prisma';
import { buildScopeWhere } from '../../common/scoping/scope.helper';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { PrismaService } from '../../prisma/prisma.service';
import { normalizeKzPhone } from '../users/utils/normalize-phone';
import { ListSalesDto } from './dto/list-sales.dto';
import type { SaleListResponseDto, SaleRowDto } from './dto/sale-row.dto';
import { SALE_SCOPE_RULES } from './sales.scope';

/**
 * PAY-02 — paginated, scoped, filtered Sale list (Plan 03).
 *
 * Schema-truth (verified against prisma/schema.prisma:715-746):
 *   - Default sort = `created_at desc` (uses `idx_sales_created_at` from
 *     Phase 1.08 -> sub-second TTFB).
 *   - `created_at` is `Int @db.UnsignedInt` (NOT NULL); `id` is added as
 *     tie-breaker for stable cursor pagination.
 *   - `refund_at` is `Int? @db.UnsignedInt` (NULLABLE; null = active sale).
 *   - `q` searches the buyer relation (`User.full_name` | `email` | `mobile`).
 *     Mobile is normalized via `normalizeKzPhone` so partial-digit input
 *     `7012` still hits canonical `+77012...`.
 *
 * Scope (D-18, D-20, T-09-03-01): admin sees all; curator + teacher get
 * `id: { in: [] }` via SALE_SCOPE_RULES (default-deny). RolesGuard already
 * rejects them at @Roles('admin'); the scope is belt-and-braces.
 *
 * BigInt + Decimal: Sale id + relation ids are Int (plain `number`); Decimal
 * fields (`amount`, `total_amount`) are converted to STRING at the row-mapping
 * boundary so the wire format matches the locked admin-client contract
 * (lib/sales/types.ts -> `amount: string`, `total_amount: string | null`).
 *
 * `product_label` is computed inline from the eagerly-selected RU translation
 * for the Sale's product (webinar | quiz | quiz_badge). KZ-only products
 * surface as `product_label: null` (the translations[] filter yields empty);
 * admin operators primarily read RU per CONTEXT D-25.
 */
@Injectable()
export class SalesListService {
    private readonly logger = new Logger(SalesListService.name);

    public static readonly DEFAULT_PAGE_SIZE = 50;
    public static readonly MAX_PAGE_SIZE = 200;

    constructor(private readonly prisma: PrismaService) {}

    public async list(actor: ScopeActor, query: ListSalesDto): Promise<SaleListResponseDto> {
        const page = Math.max(1, query.page ?? 1);
        const page_size = Math.min(
            SalesListService.MAX_PAGE_SIZE,
            Math.max(1, query.page_size ?? SalesListService.DEFAULT_PAGE_SIZE),
        );
        const sort = query.sort ?? 'created_at';
        const order: 'asc' | 'desc' = query.order ?? 'desc';

        const filterWhere = this.buildFilterWhere(query);

        const scopeWhere = buildScopeWhere(actor, SALE_SCOPE_RULES);
        const where: any = { ...filterWhere, ...scopeWhere };

        // Cursor pagination overrides offset.
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
            sort === 'id'
                ? { id: order }
                : sort === 'amount'
                ? { amount: order }
                : { created_at: order };

        // 1+1 query: count + page rows. Explicit `select` projects only the
        // columns we serialize on the wire.
        const [total, rows] = await this.prisma.$transaction([
            this.prisma.sale.count({ where: finalWhere }),
            this.prisma.sale.findMany({
                where: finalWhere,
                select: {
                    id: true,
                    seller_id: true,
                    type: true,
                    payment_method: true,
                    amount: true,
                    total_amount: true,
                    manual_added: true,
                    created_at: true,
                    refund_at: true,
                    webinar_id: true,
                    quiz_id: true,
                    quiz_badge_id: true,
                    buyer: { select: { id: true, full_name: true, email: true, mobile: true } },
                    webinar: {
                        select: {
                            translations: {
                                where: { locale: 'ru' },
                                select: { title: true },
                                take: 1,
                            },
                        },
                    },
                    quiz: {
                        select: {
                            translations: {
                                where: { locale: 'ru' },
                                select: { title: true },
                                take: 1,
                            },
                        },
                    },
                    quiz_badge: {
                        select: {
                            translations: {
                                where: { locale: 'ru' },
                                select: { title: true },
                                take: 1,
                            },
                        },
                    },
                },
                orderBy: [orderBy, { id: order }],
                take: page_size,
                skip,
            }),
        ]);

        const out: SaleRowDto[] = rows.map((r: any) => ({
            id: Number(r.id),
            buyer: {
                id: Number(r.buyer?.id ?? 0),
                full_name: r.buyer?.full_name ?? null,
                email: r.buyer?.email ?? null,
                mobile: r.buyer?.mobile ?? null,
            },
            seller_id: r.seller_id ?? null,
            type: r.type ?? null,
            payment_method: r.payment_method ?? null,
            amount: r.amount?.toString() ?? '0',
            total_amount: r.total_amount?.toString() ?? null,
            manual_added: !!r.manual_added,
            created_at: Number(r.created_at),
            refund_at: r.refund_at ?? null,
            product_label: this.deriveProductLabel(r),
        }));

        const next_cursor = out.length === page_size ? String(out[out.length - 1].id) : null;

        return { rows: out, total, page, page_size, next_cursor };
    }

    /**
     * Compose the filter `where` fragment from the DTO. Extracted as a separate
     * method so SalesExportService.fetchRows can reuse the exact same predicate
     * composition (filter parity between list + export — same approach as
     * Phase 9 Plan 02 PaymentsListService).
     */
    public buildFilterWhere(query: {
        type?: 'webinar' | 'quiz' | 'quiz_badge';
        payment_method?: 'credit' | 'payment_channel' | 'subscribe' | 'group_access';
        only_refunded?: boolean;
        only_manual?: boolean;
        date_from?: number;
        date_to?: number;
        q?: string;
    }): Prisma.SaleWhereInput {
        const filterWhere: any = {};

        if (query.type) {
            filterWhere.type = query.type;
        }

        if (query.payment_method) {
            filterWhere.payment_method = query.payment_method;
        }

        if (query.only_refunded === true) {
            filterWhere.refund_at = { not: null };
        }

        if (query.only_manual === true) {
            filterWhere.manual_added = true;
        }

        // created_at range: [date_from, date_to)
        if (typeof query.date_from === 'number' || typeof query.date_to === 'number') {
            const range: any = {};
            if (typeof query.date_from === 'number') range.gte = query.date_from;
            if (typeof query.date_to === 'number') range.lt = query.date_to;
            filterWhere.created_at = range;
        }

        if (query.q && query.q.trim().length > 0) {
            const raw = query.q.trim();
            // MySQL utf8mb4_general_ci handles case-insensitivity for `contains`;
            // Prisma's `mode: 'insensitive'` is Postgres-only and would type-error.
            const phoneNorm = normalizeKzPhone(raw);
            filterWhere.buyer = {
                is: {
                    OR: [
                        { full_name: { contains: raw } },
                        { email: { contains: raw } },
                        { mobile: { contains: phoneNorm ?? raw } },
                    ],
                },
            };
        }

        return filterWhere as Prisma.SaleWhereInput;
    }

    /**
     * Map Sale.type + the eagerly-selected translations[ru].title to a flat
     * `product_label` string. Reused by the export service so list + export
     * produce identical product labels.
     */
    public deriveProductLabel(row: any): string | null {
        if (row.type === 'webinar') {
            return row.webinar?.translations?.[0]?.title ?? null;
        }
        if (row.type === 'quiz') {
            return row.quiz?.translations?.[0]?.title ?? null;
        }
        if (row.type === 'quiz_badge') {
            return row.quiz_badge?.translations?.[0]?.title ?? null;
        }
        return null;
    }
}
