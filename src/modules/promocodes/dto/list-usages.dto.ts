import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * PRM-02 — list-usages query DTO (Phase 7 Plan 05).
 *
 * Returns paginated PromocodeUsage rows for a single promocode_id (path param on
 * controller). Sort default: used_at desc. Page size default: 50, max 200.
 */
export type UsageSortField = 'used_at';
export type SortOrder = 'asc' | 'desc';

export class ListUsagesDto {
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
    @IsIn(['used_at'])
    sort?: UsageSortField;

    @IsOptional()
    @IsIn(['asc', 'desc'])
    order?: SortOrder;
}
