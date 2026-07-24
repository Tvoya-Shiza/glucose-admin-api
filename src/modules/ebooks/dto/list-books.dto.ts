import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * Phase 39/40 — list-books (ebooks) query DTO. All fields optional.
 *
 * Default sort: created_at desc. Default page size: 50, capped at 200.
 *
 * Filters:
 *   - q            → kz BookTranslation.title (contains, case-insensitive via collation)
 *   - status       → Book.status (draft | active | inactive)
 *   - subject_id   → Book.subject_id
 *   - publisher_id → Book.publisher_id
 *   - grade        → Book.grade (1..11)
 *
 * Soft-deleted books (deleted_at != null) never surface here.
 */
export type BookStatusFilter = 'draft' | 'active' | 'inactive';

export class ListBooksDto {
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
    @MaxLength(200)
    q?: string;

    @IsOptional()
    @IsIn(['draft', 'active', 'inactive'])
    status?: BookStatusFilter;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    subject_id?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    publisher_id?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(11)
    grade?: number;
}
