import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * BAN-01 — list-banners query DTO (Phase 7 Plan 03).
 *
 * Mirrors ListStoriesDto (Plan 02) — banners share the same status/sort/filter shape
 * with the Advertisement model. NO `icon` field on Advertisement; query DTO is
 * status/category/q/sort/order only.
 *
 * All fields optional. Numeric query string fields are coerced via @Type(() => Number).
 *
 * Default sort: created_at desc. Default page size: 50 (mirrors Phase 5 / Plan 02).
 *
 * Schema-truth notes (Plan 01 reconciliation table):
 *   - Advertisement.status enum: BlogStatus = 'pending' | 'publish'.
 *   - search `q`: matches Advertisement.slug OR any AdvertisementTranslation.title.
 *   - sort 'visit_count': Advertisement.visit_count (Int @default(0) @db.UnsignedInt).
 *   - sort 'updated_at': Advertisement.updated_at (Int @db.UnsignedInt — Unix seconds).
 */
export type BannerStatusFilter = 'pending' | 'publish';
export type BannerSortField = 'created_at' | 'updated_at' | 'visit_count';
export type SortOrder = 'asc' | 'desc';

export class ListBannersDto {
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
    @IsIn(['pending', 'publish'])
    status?: BannerStatusFilter;

    @IsOptional()
    @IsString()
    @MaxLength(200)
    q?: string;

    @IsOptional()
    @IsIn(['created_at', 'updated_at', 'visit_count'])
    sort?: BannerSortField;

    @IsOptional()
    @IsIn(['asc', 'desc'])
    order?: SortOrder;
}
