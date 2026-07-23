import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * Phase 38 — partial-update body DTO for PATCH /admin-api/v1/admin/trainers/:id.
 *
 * Same field → storage mapping as CreateTrainerDto. Every field optional:
 *   - undefined → leave unchanged
 *   - null      → clear (nullable columns: category_id, seconds_per_question,
 *                 attempts_limit, background_image, available_from, available_to)
 *
 * `course_ids` (when provided) DIFF-REPLACES the trainer_courses link set inside
 * the update transaction: removed links are deleted, new ones inserted, kept ones
 * untouched (preserves created_at on surviving rows).
 *
 * Cross-field rules (timer seconds requirement, available window ordering) are
 * validated in the service against the MERGED (dto over existing) state.
 */
export class UpdateTrainerDto {
    @IsOptional()
    @IsString()
    @MaxLength(500)
    title?: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    category_id?: number | null;

    @IsOptional()
    @IsBoolean()
    timer_enabled?: boolean;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(5)
    @Max(600)
    seconds_per_question?: number | null;

    @IsOptional()
    @IsBoolean()
    shuffle_questions?: boolean;

    @IsOptional()
    @IsBoolean()
    shuffle_answers?: boolean;

    @IsOptional()
    @IsBoolean()
    flashcards_enabled?: boolean;

    /** 0 = unlimited (stored as NULL in Quizzes.attempt). */
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    attempts_limit?: number | null;

    @IsOptional()
    @IsString()
    @MaxLength(512)
    background_image?: string | null;

    /** Unix seconds. */
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    available_from?: number | null;

    /** Unix seconds. */
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    available_to?: number | null;

    @IsOptional()
    @IsArray()
    @ArrayMaxSize(50)
    @Type(() => Number)
    @IsInt({ each: true })
    @Min(1, { each: true })
    course_ids?: number[];
}
