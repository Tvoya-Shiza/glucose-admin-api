import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * Phase 39/40 — create-book (ebook) body DTO.
 *
 * Field → storage mapping:
 *   - title        → BookTranslation (locale='kz'), VarChar(512)
 *   - description  → BookTranslation.description (Text), locale='kz'
 *   - subject_id   → Book.subject_id (FK QuizSubject, SET NULL)
 *   - publisher_id → Book.publisher_id (FK Publisher, SET NULL)
 *   - grade        → Book.grade (UnsignedTinyInt, 1..11)
 *   - language     → Book.language (VarChar(8), default 'kz')
 *   - authors      → Book.authors (VarChar(512), nullable) — credit line as printed
 *   - year         → Book.year (SmallInt)
 *   - cover_image  → Book.cover_image (VarChar(512)) — a URL from the existing upload flow
 *   - status       → Book.status (draft | active | inactive; default 'draft')
 *
 * The book row + its kz book_translations row are written together in a $transaction.
 * cover_image/page image URLs are produced by the existing uploads surface — this
 * module accepts the resulting URL string, it does NOT upload files.
 */
export class CreateBookDto {
    @IsString()
    @MaxLength(512)
    title!: string;

    @IsOptional()
    @IsString()
    @MaxLength(10000)
    description?: string;

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

    @IsOptional()
    @IsString()
    @MaxLength(8)
    language?: string;

    /** Free-form credit line, e.g. «Н.С. Бакина, Н.Т. Жанақова». Display only. */
    @IsOptional()
    @IsString()
    @MaxLength(512)
    authors?: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1900)
    @Max(2100)
    year?: number;

    @IsOptional()
    @IsString()
    @MaxLength(512)
    cover_image?: string;

    @IsOptional()
    @IsIn(['draft', 'active', 'inactive'])
    status?: 'draft' | 'active' | 'inactive';
}
