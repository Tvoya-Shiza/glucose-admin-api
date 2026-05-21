import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { PrismaService } from '../../prisma/prisma.service';
import type { SaleDetailDto } from './dto/sale-row.dto';

/**
 * PAY-02 / D-06 — GET /admin-api/v1/admin/sales/:id detail.
 *
 * Surfaces the full Sale row + buyer ref + product translation + best-effort
 * KaspiPayment trace matched on `account == buyer_id`.
 *
 * Schema-truth (verified against schema.prisma:715-746 + 793-814):
 *   - All Sale Decimal columns serialized as STRING (BigInt-as-string posture
 *     extends to Decimal per glucose-admin-api/CLAUDE.md).
 *   - Sale.refund_at is `Int? @db.UnsignedInt` (Unix sec; null = active).
 *   - KaspiPayment.txn_id BigInt -> STRING; sum Decimal -> STRING.
 *   - Match heuristic: Kaspi callback (in glucose-api) writes the buyer's
 *     user.id into `KaspiPayment.account` on payment creation. NO FK
 *     constraint — match is best-effort.
 *
 * Scope (D-18, D-20, T-09-03-01): RolesGuard already rejects non-admin at the
 * controller (@Roles('admin')). Service throws ForbiddenException as belt-and-
 * braces if the gate ever drifts.
 */
@Injectable()
export class SalesDetailService {
    private readonly logger = new Logger(SalesDetailService.name);

    /** Cap payment_trace lookup so a power-user buyer with hundreds of payments
     *  does not bloat the detail payload. 10 mirrors the doc-comment in the plan. */
    public static readonly PAYMENT_TRACE_LIMIT = 10;

    constructor(private readonly prisma: PrismaService) {}

    public async get(actor: ScopeActor, id: number): Promise<SaleDetailDto> {
        if (actor.role_name !== 'admin') {
            // Belt-and-braces — RolesGuard already rejects this; throw to be explicit.
            throw new ForbiddenException('sales.admin_only');
        }

        const row: any = await this.prisma.sale.findUnique({
            where: { id },
            select: {
                id: true,
                seller_id: true,
                buyer_id: true,
                order_id: true,
                webinar_id: true,
                quiz_id: true,
                quiz_badge_id: true,
                type: true,
                payment_method: true,
                amount: true,
                tax: true,
                commission: true,
                discount: true,
                total_amount: true,
                manual_added: true,
                access_to_purchased_item: true,
                access_days: true,
                created_at: true,
                refund_at: true,
                buyer: { select: { id: true, full_name: true, email: true, mobile: true } },
                group: { select: { id: true, name: true } },
                webinar: {
                    select: {
                        translations: {
                            where: { locale: 'kz' },
                            select: { title: true },
                            take: 1,
                        },
                    },
                },
                quiz: {
                    select: {
                        translations: {
                            where: { locale: 'kz' },
                            select: { title: true },
                            take: 1,
                        },
                    },
                },
                quiz_badge: {
                    select: {
                        translations: {
                            where: { locale: 'kz' },
                            select: { title: true },
                            take: 1,
                        },
                    },
                },
            },
        });

        if (!row) {
            throw new NotFoundException('sales.not_found');
        }

        // Best-effort payment trace: KaspiPayment.account == Sale.buyer_id.
        // No FK; match is heuristic. Same approach Phase 9 Plan 02 uses for
        // PaymentsDetailService.related_sales.
        //
        // Phase 18: group-scoped sales (buyer_id IS NULL) have no payment trace
        // by definition — they are admin-manual grants, not Kaspi transactions.
        const trace: any[] =
            row.buyer_id === null || row.buyer_id === undefined
                ? []
                : await this.prisma.kaspiPayment.findMany({
                      where: { account: row.buyer_id },
                      select: {
                          id: true,
                          txn_id: true,
                          txn_date: true,
                          sum: true,
                          status: true,
                      },
                      orderBy: { txn_date: 'desc' },
                      take: SalesDetailService.PAYMENT_TRACE_LIMIT,
                  });

        const product_label =
            row.type === 'webinar'
                ? row.webinar?.translations?.[0]?.title ?? null
                : row.type === 'quiz'
                ? row.quiz?.translations?.[0]?.title ?? null
                : row.type === 'quiz_badge'
                ? row.quiz_badge?.translations?.[0]?.title ?? null
                : null;

        return {
            id: Number(row.id),
            buyer: row.buyer
                ? {
                      id: Number(row.buyer.id),
                      full_name: row.buyer.full_name ?? null,
                      email: row.buyer.email ?? null,
                      mobile: row.buyer.mobile ?? null,
                  }
                : null,
            group: row.group ? { id: Number(row.group.id), name: row.group.name } : null,
            seller_id: row.seller_id ?? null,
            type: row.type ?? null,
            payment_method: row.payment_method ?? null,
            amount: row.amount?.toString() ?? '0',
            total_amount: row.total_amount?.toString() ?? null,
            manual_added: !!row.manual_added,
            created_at: Number(row.created_at),
            refund_at: row.refund_at ?? null,
            product_label,
            order_id: row.order_id ?? null,
            quiz_id: row.quiz_id ?? null,
            quiz_badge_id: row.quiz_badge_id ?? null,
            webinar_id: row.webinar_id ?? null,
            tax: row.tax?.toString() ?? null,
            commission: row.commission?.toString() ?? null,
            discount: row.discount?.toString() ?? null,
            access_to_purchased_item: !!row.access_to_purchased_item,
            access_days: row.access_days ?? null,
            payment_trace: trace.map((t) => ({
                id: Number(t.id),
                txn_id: typeof t.txn_id === 'bigint' ? t.txn_id.toString() : String(t.txn_id),
                txn_date: t.txn_date ?? null,
                sum: t.sum?.toString() ?? '0',
                status: t.status ?? null,
            })),
        };
    }
}
