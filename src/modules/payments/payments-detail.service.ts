import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { PrismaService } from '../../prisma/prisma.service';
import type { PaymentDetailDto } from './dto/payment-row.dto';

/**
 * PAY-01 / D-04 — GET /admin-api/v1/admin/payments/:id detail.
 *
 * Surfaces:
 *   - The full KaspiPayment row + raw data1..data10 Kaspi callback fields (D-04).
 *   - Best-effort related Sale rows matched by `KaspiPayment.account == User.id`.
 *
 * Schema-truth (verified against schema.prisma:715-744 + 793-814):
 *   - `Sale.refund_at Int? @db.UnsignedInt` (Unix sec; null = active sale).
 *   - `Sale.total_amount Decimal? @db.Decimal(13,2)` -> serialized as STRING.
 *   - The Kaspi callback (in glucose-api) writes the buyer's user.id into
 *     `KaspiPayment.account` on payment creation. The match is BEST-EFFORT
 *     because there is NO FK constraint between the two tables.
 *
 * Scope (D-18, T-09-02-01): access is governed at runtime by the controller's
 * @RequirePermission('payments.view') grant. No per-row narrowing applies — any
 * role granted the permission sees the requested payment row.
 */
@Injectable()
export class PaymentsDetailService {
    private readonly logger = new Logger(PaymentsDetailService.name);

    /** Cap related_sales lookup so a power-user buyer with hundreds of sales does
     *  not bloat the detail payload. 20 is the same cap as Phase 3 user-detail. */
    public static readonly RELATED_SALES_LIMIT = 20;

    constructor(private readonly prisma: PrismaService) {}

    public async get(actor: ScopeActor, id: number): Promise<PaymentDetailDto> {
        const row = await this.prisma.kaspiPayment.findUnique({ where: { id } });
        if (!row) {
            throw new NotFoundException('payment.not_found');
        }

        // Best-effort related Sale rows — match by KaspiPayment.account == User.id.
        // No FK constraint exists between the two tables; if account does not map
        // to a real user, related is `[]`.
        //
        // Phase 18: explicitly filter `buyer_id IS NOT NULL`. Group-scoped sales
        // (group_id set, buyer_id NULL) have no Kaspi payment trace by definition
        // — admin-manual grants are not Kaspi transactions. Without this guard
        // a payment whose `account` happens to be 0/NULL would loud-match every
        // group sale.
        const related = await this.prisma.sale.findMany({
            where: { buyer_id: row.account, AND: { buyer_id: { not: null } } },
            select: {
                id: true,
                buyer_id: true,
                webinar_id: true,
                created_at: true,
                total_amount: true,
            },
            orderBy: { created_at: 'desc' },
            take: PaymentsDetailService.RELATED_SALES_LIMIT,
        });

        return {
            id: Number(row.id),
            txn_id: typeof row.txn_id === 'bigint' ? row.txn_id.toString() : String(row.txn_id),
            txn_date: row.txn_date ?? null,
            account: Number(row.account),
            sum: row.sum?.toString() ?? '0',
            status: row.status ?? null,
            data1: row.data1 ?? null,
            data2: row.data2 ?? null,
            data3: row.data3 ?? null,
            data4: row.data4 ?? null,
            data5: row.data5 ?? null,
            data6: row.data6 ?? null,
            data7: row.data7 ?? null,
            data8: row.data8 ?? null,
            data9: row.data9 ?? null,
            data10: row.data10 ?? null,
            related_sales: related.map((s: any) => ({
                id: Number(s.id),
                buyer_id: s.buyer_id !== null && s.buyer_id !== undefined ? Number(s.buyer_id) : null,
                webinar_id: s.webinar_id ?? null,
                created_at: Number(s.created_at),
                total_amount: s.total_amount?.toString() ?? null,
            })),
        };
    }
}
