import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * STY-01 — list-stories query DTO (Phase 7 Plan 02).
 *
 * All fields optional. Numeric query string fields are coerced via @Type(() => Number).
 *
 * Default sort: created_at desc. Default page size: 50 (mirrors Phase 5 courses).
 *
 * Schema-truth notes (Plan 01 reconciliation table):
 *   - Story.status enum: BlogStatus = 'pending' | 'publish' (schema lines 165-168, 1286).
 *   - search `q`: matches Story.slug OR any StoryTranslation.title — built in service via OR/some.
 *   - sort 'visit_count': sorts by Story.visit_count (Int @default(0) @db.UnsignedInt).
 *   - sort 'updated_at': sorts by Story.updated_at (Int @db.UnsignedInt — Unix seconds).
 */
export type StoryStatusFilter = 'pending' | 'publish';
export type StorySortField = 'created_at' | 'updated_at' | 'visit_count';
export type SortOrder = 'asc' | 'desc';

export class ListStoriesDto {
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
    status?: StoryStatusFilter;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    category_id?: number;

    @IsOptional()
    @IsString()
    @MaxLength(200)
    q?: string;

    @IsOptional()
    @IsIn(['created_at', 'updated_at', 'visit_count'])
    sort?: StorySortField;

    @IsOptional()
    @IsIn(['asc', 'desc'])
    order?: SortOrder;
}
