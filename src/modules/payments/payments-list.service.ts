import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from 'generated/prisma';
import { buildScopeWhere } from '../../common/scoping/scope.helper';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { PrismaService } from '../../prisma/prisma.service';
import { ListPaymentsDto } from './dto/list-payments.dto';
import type { PaymentListResponseDto, PaymentRowDto } from './dto/payment-row.dto';
import { KASPI_SCOPE_RULES } from './payments.scope';

/**
 * PAY-01 — paginated, scoped, filtered KaspiPayment list (Plan 02).
 *
 * Schema-truth (verified against prisma/schema.prisma:793-814):
 *   - Default sort = `txn_date desc` (uses `idx_kaspi_payments_txn_date` from
 *     Phase 1.08 -> sub-second TTFB).
 *   - `txn_date` is NULLABLE — NULL rows naturally fall to end on `desc` order
 *     in MySQL. `id` is added as tie-breaker for stable cursor pagination.
 *   - `q` parsing: digits-only -> account (Int) exact-match if <= 2^31-1 AND/OR
 *     txn_id (BigInt) match. Non-digit input is ignored (no string fields on
 *     KaspiPayment to contain-search). UI surfaces empty results.
 *
 * Hybrid pagination (mirrors UsersListService):
 *   - cursor present -> WHERE id <op> cursor; skip = 0
 *   - cursor absent  -> standard offset (page-1) * page_size
 *
 * Scope (D-18, T-09-01-01): access is governed at runtime by
 * @RequirePermission('payments.view'). KASPI_SCOPE_RULES applies no per-row
 * narrowing — any granted role sees all KaspiPayment rows.
 *
 * BigInt + Decimal: `txn_id` and `sum` are converted to STRING at the row-mapping
 * boundary so the wire format matches the locked admin-client contract
 * (lib/payments/types.ts -> `txn_id: string`, `sum: string`).
 */
@Injectable()
export class PaymentsListService {
    private readonly logger = new Logger(PaymentsListService.name);

    public static readonly DEFAULT_PAGE_SIZE = 50;
    public static readonly MAX_PAGE_SIZE = 200;
    public static readonly INT_MAX = 2_147_483_647;

    constructor(private readonly prisma: PrismaService) {}

    public async list(actor: ScopeActor, query: ListPaymentsDto): Promise<PaymentListResponseDto> {
        const page = Math.max(1, query.page ?? 1);
        const page_size = Math.min(
            PaymentsListService.MAX_PAGE_SIZE,
            Math.max(1, query.page_size ?? PaymentsListService.DEFAULT_PAGE_SIZE),
        );
        const sort = query.sort ?? 'txn_date';
        const order: 'asc' | 'desc' = query.order ?? 'desc';

        const filterWhere = this.buildFilterWhere(query);

        const scopeWhere = buildScopeWhere(actor, KASPI_SCOPE_RULES);
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
                : sort === 'sum'
                ? { sum: order }
                : { txn_date: order };

        // 1+1 query: count + page rows. Explicit `select` avoids projecting the heavy
        // data1..data10 Text payloads (only detail endpoint reads them).
        const [total, rows] = await this.prisma.$transaction([
            this.prisma.kaspiPayment.count({ where: finalWhere }),
            this.prisma.kaspiPayment.findMany({
                where: finalWhere,
                select: {
                    id: true,
                    txn_id: true,
                    txn_date: true,
                    account: true,
                    sum: true,
                    status: true,
                },
                // Tie-breaker on id so cursor pagination is deterministic.
                orderBy: [orderBy, { id: order }],
                take: page_size,
                skip,
            }),
        ]);

        const out: PaymentRowDto[] = rows.map((r: any) => ({
            id: Number(r.id),
            txn_id: typeof r.txn_id === 'bigint' ? r.txn_id.toString() : String(r.txn_id),
            txn_date: r.txn_date ?? null,
            account: Number(r.account),
            sum: r.sum?.toString() ?? '0',
            status: r.status ?? null,
        }));

        const next_cursor = out.length === page_size ? String(out[out.length - 1].id) : null;

        return { rows: out, total, page, page_size, next_cursor };
    }

    /**
     * Compose the filter `where` fragment from the DTO. Extracted as a separate
     * method so PaymentsExportService can reuse the exact same predicate composition
     * (filter parity between list + export — T-09-02-01 belt-and-braces).
     */
    public buildFilterWhere(query: {
        status?: number;
        date_from?: number;
        date_to?: number;
        amount_min?: string;
        amount_max?: string;
        q?: string;
    }): Prisma.KaspiPaymentWhereInput {
        const filterWhere: any = {};

        if (typeof query.status === 'number') {
            filterWhere.status = query.status;
        }

        // txn_date range: [date_from, date_to)
        if (typeof query.date_from === 'number' || typeof query.date_to === 'number') {
            const range: any = {};
            if (typeof query.date_from === 'number') range.gte = query.date_from;
            if (typeof query.date_to === 'number') range.lt = query.date_to;
            filterWhere.txn_date = range;
        }

        // sum range — Decimal compare. Prisma accepts decimal-as-string in
        // Decimal field operators; no Prisma.Decimal import needed.
        if (
            (typeof query.amount_min === 'string' && query.amount_min.length > 0) ||
            (typeof query.amount_max === 'string' && query.amount_max.length > 0)
        ) {
            const sumRange: any = {};
            if (typeof query.amount_min === 'string' && query.amount_min.length > 0) {
                sumRange.gte = query.amount_min;
            }
            if (typeof query.amount_max === 'string' && query.amount_max.length > 0) {
                sumRange.lte = query.amount_max;
            }
            filterWhere.sum = sumRange;
        }

        if (query.q && query.q.trim().length > 0) {
            const raw = query.q.trim();
            if (/^\d+$/.test(raw)) {
                // Digits-only — could be account (Int) or txn_id (BigInt). Try both.
                const search: any[] = [];
                const asInt = Number(raw);
                if (Number.isFinite(asInt) && asInt <= PaymentsListService.INT_MAX) {
                    search.push({ account: asInt });
                }
                try {
                    search.push({ txn_id: BigInt(raw) });
                } catch {
                    // Defensive: BigInt() should not throw on /^\d+$/, but skip if it does.
                }
                if (search.length > 0) {
                    filterWhere.OR = search;
                }
            }
            // Non-digit q: ignored (KaspiPayment has no string fields to contain-search).
        }

        return filterWhere as Prisma.KaspiPaymentWhereInput;
    }
}
