/**
 * PAY-01 / PAY-04 — response shapes for the payments-list, payments-detail, and
 * payments-export endpoints.
 *
 * These are NOT inbound DTOs — they're the canonical TypeScript shape for what
 * admin-api returns. The admin-client mirrors them in `src/lib/payments/types.ts`
 * (Plan 01 stubs are already locked to these names).
 *
 * BigInt + Decimal posture (per glucose-admin-api/CLAUDE.md):
 *   - `KaspiPayment.txn_id` is `BigInt @unique @db.UnsignedBigInt` -> serialized as
 *     STRING by `BigIntStringInterceptor`. Modeled here as `txn_id: string`.
 *   - `KaspiPayment.sum` is `Decimal(15, 3)` -> serialized as STRING (BigInt-as-string
 *     posture extends to Decimal). Modeled as `sum: string`.
 *   - `Sale.total_amount` is `Decimal?(13, 2)` -> serialized as STRING. Modeled as
 *     `total_amount: string | null`.
 *
 * data1..data10 are surfaced verbatim per D-04. They may carry phone-like values or
 * other Kaspi callback fields — admin-only surface (D-18) keeps the disclosure
 * footprint inside the operator population.
 */
export class PaymentRowDto {
    id!: number;
    /** BigInt-as-string. Treat as opaque ID; never `Number(value)`. */
    txn_id!: string;
    /** Unix seconds, NULLABLE per schema. */
    txn_date!: number | null;
    /** Unsigned int — kaspi callback writes the buyer's user.id here. */
    account!: number;
    /** Decimal-as-string. */
    sum!: string;
    /** Free-form integer; meanings tracked in glucose-api business logic, not on schema. */
    status!: number | null;
}

export class PaymentRelatedSaleDto {
    id!: number;
    buyer_id!: number;
    webinar_id!: number | null;
    created_at!: number;
    /** Decimal-as-string, nullable. */
    total_amount!: string | null;
}

export class PaymentDetailDto extends PaymentRowDto {
    data1!: string | null;
    data2!: string | null;
    data3!: string | null;
    data4!: string | null;
    data5!: string | null;
    data6!: string | null;
    data7!: string | null;
    data8!: string | null;
    data9!: string | null;
    data10!: string | null;
    /** Best-effort match by KaspiPayment.account == User.id (D-04). */
    related_sales!: PaymentRelatedSaleDto[];
}

export class PaymentListResponseDto {
    rows!: PaymentRowDto[];
    total!: number;
    page!: number;
    page_size!: number;
    next_cursor!: string | null;
}
