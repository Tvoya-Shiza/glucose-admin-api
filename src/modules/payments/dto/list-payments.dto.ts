import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNumberString, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * PAY-01 — list-payments query DTO.
 *
 * Schema-truth (verified against glucose-admin-api/prisma/schema.prisma:793-814):
 *   - KaspiPayment has NO `created_at` column — temporal filter/sort uses
 *     `txn_date Int? @db.UnsignedInt` (Unix seconds, NULLABLE). The hot-path
 *     index `idx_kaspi_payments_txn_date` (Phase 1.08) makes default-sort
 *     sub-second.
 *   - `KaspiPayment.status` is `Int?` (NO enum). Filter is exact-match integer.
 *   - `KaspiPayment.txn_id` is `BigInt @unique` — admin-client sends digit
 *     strings; service detects shape and maps to either `account` (Int) or
 *     `txn_id` (BigInt) match.
 *
 * Decimal-on-wire posture: `amount_min` / `amount_max` are strings (admin-client
 * passes them as opaque numeric strings; service compares with Prisma.Decimal at
 * the boundary). class-validator @IsNumberString accepts decimal strings.
 *
 * Locked field shape (Plan 02) — Plan 04 export DTO mirrors these field names
 * verbatim so URL state from the list page round-trips into the export call.
 */
export class ListPaymentsDto {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(200)
    page_size?: number;

    /** KaspiPayment.status is `Int?` — no enum on schema. Exact-match filter. */
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    status?: number;

    /** Unix seconds, inclusive lower bound on txn_date. */
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    date_from?: number;

    /** Unix seconds, exclusive upper bound on txn_date (so [from, to) buckets). */
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    date_to?: number;

    /** Decimal-as-string. Service parses with Prisma.Decimal at the boundary. */
    @IsOptional()
    @IsNumberString()
    amount_min?: string;

    @IsOptional()
    @IsNumberString()
    amount_max?: string;

    /**
     * Searches `txn_id` (BigInt) OR `account` (Int).
     * Server detects shape: digits-only -> account exact-match (if <= 2^31-1)
     * AND/OR txn_id BigInt match. Non-digit input is ignored (no string fields
     * to contain-search on KaspiPayment).
     */
    @IsOptional()
    @IsString()
    q?: string;

    @IsOptional()
    @IsIn(['txn_date', 'id', 'sum'])
    sort?: 'txn_date' | 'id' | 'sum';

    @IsOptional()
    @IsIn(['asc', 'desc'])
    order?: 'asc' | 'desc';

    @IsOptional()
    @IsString()
    cursor?: string;
}
