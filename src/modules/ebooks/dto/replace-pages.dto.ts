import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';

/**
 * Phase 39/40 — batch page upsert body for PUT /admin-api/v1/admin/ebooks/:bookId/pages.
 *
 * Each entry upserts one book_pages row by (book_id, page_number). Per-field merge
 * semantics: image_url / text_content are written only when present (undefined → left
 * unchanged on an existing row), so a caller updating only images never wipes OCR text.
 *
 * After the $transaction commits, books.page_count is recomputed as max(page_number)
 * and the changed pages are re-indexed into Postgres (best-effort, fire-and-forget).
 */
export class ReplacePageInputDto {
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page_number!: number;

    /** Page image URL (from the existing uploads surface). VarChar(512). */
    @IsOptional()
    @IsString()
    @MaxLength(512)
    image_url?: string | null;

    /** OCR / extracted page text. MediumText — bounded to 2M chars per page defensively. */
    @IsOptional()
    @IsString()
    @MaxLength(2_000_000)
    text_content?: string | null;
}

export class ReplacePagesDto {
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(2000)
    @ValidateNested({ each: true })
    @Type(() => ReplacePageInputDto)
    pages!: ReplacePageInputDto[];
}
