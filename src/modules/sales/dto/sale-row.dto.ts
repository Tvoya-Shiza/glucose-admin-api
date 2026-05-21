/**
 * PAY-02 / PAY-03 / PAY-04 — response shapes for sales-list, sales-detail,
 * and sales-export endpoints.
 *
 * Mirrors glucose-admin-client/src/lib/sales/types.ts verbatim — both files
 * are kept in lockstep with `Sale` schema model + `User` buyer ref.
 *
 * BigInt + Decimal posture (per glucose-admin-api/CLAUDE.md):
 *   - Sale id / buyer.id / seller_id / *_id are all schema Int -> plain `number`.
 *   - Sale.amount/tax/commission/discount/total_amount are Decimal(13,2) ->
 *     serialized as STRING. Modeled as `string` (or `string | null` for
 *     nullable columns).
 *   - KaspiPayment.txn_id BigInt -> serialized as STRING in payment_trace rows.
 *   - KaspiPayment.sum Decimal(15,3) -> STRING.
 *
 * `product_label` is derived server-side: when type=webinar use
 * webinar.translations[ru]?.title, type=quiz uses quiz.translations[ru]?.title,
 * type=quiz_badge uses quiz_badge.translations[ru]?.title. Null on missing.
 */
export class SaleBuyerRefDto {
    id!: number;
    full_name!: string | null;
    email!: string | null;
    mobile!: string | null;
}

/**
 * Phase 18 — group-scoped sale rows carry a `group` ref instead of a `buyer`.
 * Either `buyer` or `group` is set (enforced by `chk_sales_buyer_or_group`
 * CHECK constraint); both may co-exist on the same row only for sales
 * representing per-user group-purchase records (legacy education repo pattern,
 * not used here).
 */
export class SaleGroupRefDto {
    id!: number;
    name!: string;
}

export class SaleRowDto {
    id!: number;
    /** NULL when the sale is a group-scoped grant (Phase 18); `group` is set instead. */
    buyer!: SaleBuyerRefDto | null;
    /** NULL for direct (per-user) sales; populated for Phase 18 group grants. */
    group!: SaleGroupRefDto | null;
    seller_id!: number | null;
    type!: 'webinar' | 'quiz' | 'quiz_badge' | null;
    payment_method!: 'credit' | 'payment_channel' | 'subscribe' | 'group_access' | null;
    /** Decimal-as-string. */
    amount!: string;
    /** Decimal-as-string, NULLABLE. */
    total_amount!: string | null;
    manual_added!: boolean;
    created_at!: number;
    refund_at!: number | null;
    /** Server-derived from translations[ru].title for the type's product. */
    product_label!: string | null;
}

export class SalePaymentTraceRowDto {
    id!: number;
    /** BigInt-as-string. */
    txn_id!: string;
    txn_date!: number | null;
    /** Decimal-as-string. */
    sum!: string;
    status!: number | null;
}

export class SaleDetailDto extends SaleRowDto {
    order_id!: number | null;
    quiz_id!: number | null;
    quiz_badge_id!: number | null;
    webinar_id!: number | null;
    /** Decimal-as-string, NULLABLE. */
    tax!: string | null;
    commission!: string | null;
    discount!: string | null;
    access_to_purchased_item!: boolean;
    access_days!: number | null;
    /**
     * Best-effort payment trace: KaspiPayment rows where account == buyer_id.
     * No FK between Sale.buyer_id and KaspiPayment.account; match is heuristic.
     */
    payment_trace!: SalePaymentTraceRowDto[];
}

export class SaleListResponseDto {
    rows!: SaleRowDto[];
    total!: number;
    page!: number;
    page_size!: number;
    next_cursor!: string | null;
}
