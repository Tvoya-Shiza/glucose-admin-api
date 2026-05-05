import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * PAY-02 — list-sales query DTO.
 *
 * Schema-truth (verified against glucose-admin-api/prisma/schema.prisma:715-746):
 *   - Sale.created_at is `Int @db.UnsignedInt` (Unix sec, NOT NULL). Hot-path
 *     index `idx_sales_created_at` (Phase 1.08) makes the default-sort
 *     sub-second.
 *   - Sale.refund_at is `Int? @db.UnsignedInt` (NULLABLE; null = active).
 *     `only_refunded=true` -> `refund_at: { not: null }`.
 *   - Sale.type is `SaleType?` enum (webinar | quiz | quiz_badge).
 *   - Sale.payment_method is `PaymentMethod?` enum
 *     (credit | payment_channel | subscribe | group_access).
 *   - Sale.manual_added Boolean — `only_manual=true` -> `manual_added: true`.
 *
 * `q` searches the buyer relation (User.full_name | User.email | User.mobile).
 * Mobile is normalized via the same `normalizeKzPhone` helper Phase 3 uses for
 * users — partial-digit input `7012` still hits canonical `+77012...`.
 *
 * Locked field shape (Plan 03) — Plan 04 export DTO mirrors these field names
 * verbatim so URL state from the list page round-trips into the export call.
 */
export class ListSalesDto {
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

    /** SaleType enum exact-match. */
    @IsOptional()
    @IsIn(['webinar', 'quiz', 'quiz_badge'])
    type?: 'webinar' | 'quiz' | 'quiz_badge';

    /** PaymentMethod enum exact-match. */
    @IsOptional()
    @IsIn(['credit', 'payment_channel', 'subscribe', 'group_access'])
    payment_method?: 'credit' | 'payment_channel' | 'subscribe' | 'group_access';

    /**
     * Boolean from query string. class-transformer's Boolean conversion accepts
     * 'true' / 'false' / '1' / '0' (and yields false for empty). class-validator
     * still gates the resulting value through @IsBoolean for safety.
     */
    @IsOptional()
    @Type(() => Boolean)
    @IsBoolean()
    only_refunded?: boolean;

    @IsOptional()
    @Type(() => Boolean)
    @IsBoolean()
    only_manual?: boolean;

    /** Unix seconds, inclusive lower bound on created_at. */
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    date_from?: number;

    /** Unix seconds, exclusive upper bound on created_at (so [from, to) buckets). */
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    date_to?: number;

    /** Searches buyer.full_name | buyer.email | buyer.mobile (mobile normalized via normalizeKzPhone). */
    @IsOptional()
    @IsString()
    q?: string;

    @IsOptional()
    @IsIn(['created_at', 'id', 'amount'])
    sort?: 'created_at' | 'id' | 'amount';

    @IsOptional()
    @IsIn(['asc', 'desc'])
    order?: 'asc' | 'desc';

    @IsOptional()
    @IsString()
    cursor?: string;
}
