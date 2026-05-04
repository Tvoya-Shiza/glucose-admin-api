import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * PRM-01 — list-promocodes query DTO (Phase 7 Plan 05).
 *
 * All fields optional. Numeric query string fields are coerced via @Type(() => Number);
 * boolean `is_active` is coerced via @Transform.
 *
 * Default sort: created_at desc. Default page size: 50.
 *
 * Schema-truth notes (Plan 01 reconciliation lock):
 *   - Promocode.discount_type is `String @db.VarChar(255)` containing 'percentage' or 'fixed'.
 *   - Promocode.is_active is `Boolean @db.TinyInt`.
 *   - status_window is computed in the service from start_date/expires_at vs Math.floor(Date.now()/1000).
 *   - sort=usage_count uses Prisma `_count.usages` orderBy.
 *   - q matches Promocode.code OR Promocode.title.
 */
export type DiscountTypeFilter = 'percentage' | 'fixed';
export type StatusWindowFilter = 'active' | 'expired' | 'future' | 'all';
export type PromocodeSortField = 'created_at' | 'expires_at' | 'usage_count';
export type SortOrder = 'asc' | 'desc';

export class ListPromocodesDto {
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

    @IsOptional()
    @IsString()
    @MaxLength(255)
    q?: string;

    @IsOptional()
    @IsIn(['percentage', 'fixed'])
    discount_type?: DiscountTypeFilter;

    @IsOptional()
    @Transform(({ value }) => {
        if (value === 'true' || value === true) return true;
        if (value === 'false' || value === false) return false;
        return value;
    })
    @IsBoolean()
    is_active?: boolean;

    @IsOptional()
    @IsIn(['active', 'expired', 'future', 'all'])
    status_window?: StatusWindowFilter;

    @IsOptional()
    @IsIn(['created_at', 'expires_at', 'usage_count'])
    sort?: PromocodeSortField;

    @IsOptional()
    @IsIn(['asc', 'desc'])
    order?: SortOrder;
}
