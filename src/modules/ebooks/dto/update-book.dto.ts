import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * Phase 39/40 — partial-update body DTO for PATCH /admin-api/v1/admin/ebooks/:id.
 *
 * Same field → storage mapping as CreateBookDto. Every field optional:
 *   - undefined → leave unchanged
 *   - null      → clear (nullable columns: description, subject_id, publisher_id,
 *                 grade, year, cover_image)
 *
 * @IsOptional() allows null through validation (it short-circuits on null|undefined),
 * so the service can distinguish "clear" (null) from "unchanged" (undefined) — same
 * convention as UpdateTrainerDto.
 *
 * Publication status is NOT changed here — use PATCH :id/publish (which runs the
 * page_count gate and enqueues reindex on transition to 'active').
 */
export class UpdateBookDto {
    @IsOptional()
    @IsString()
    @MaxLength(512)
    title?: string;

    @IsOptional()
    @IsString()
    @MaxLength(10000)
    description?: string | null;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    subject_id?: number | null;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    publisher_id?: number | null;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(11)
    grade?: number | null;

    @IsOptional()
    @IsString()
    @MaxLength(8)
    language?: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1900)
    @Max(2100)
    year?: number | null;

    @IsOptional()
    @IsString()
    @MaxLength(512)
    cover_image?: string | null;
}
