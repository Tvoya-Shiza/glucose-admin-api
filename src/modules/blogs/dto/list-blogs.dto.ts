import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * BLG-01 — list-blogs query DTO (Phase 7 Plan 04).
 *
 * Schema-truth notes (Plan 01 reconciliation):
 *   - Blog.status enum: BlogStatus = 'pending' | 'publish'.
 *   - search `q`: matches Blog.slug OR any BlogTranslation.title.
 *   - sort 'visit_count' / 'updated_at' / 'created_at' all map to columns on Blog
 *     (Int @db.UnsignedInt — Unix seconds for timestamps).
 *
 * Mirrors ListStoriesDto verbatim with field-name parity. Author filter (`author_id`)
 * is a Phase 7 Plan 04 addition (D-11 — admins frequently filter by author when
 * curating editorial workflows; the underlying column is FK Blog.author_id).
 */
export type BlogStatusFilter = 'pending' | 'publish';
export type BlogSortField = 'created_at' | 'updated_at' | 'visit_count';
export type SortOrder = 'asc' | 'desc';

export class ListBlogsDto {
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
    status?: BlogStatusFilter;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    category_id?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    author_id?: number;

    @IsOptional()
    @IsString()
    @MaxLength(200)
    q?: string;

    @IsOptional()
    @IsIn(['created_at', 'updated_at', 'visit_count'])
    sort?: BlogSortField;

    @IsOptional()
    @IsIn(['asc', 'desc'])
    order?: SortOrder;
}
