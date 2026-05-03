import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    ArrayMinSize,
    IsArray,
    IsBoolean,
    IsIn,
    IsInt,
    IsOptional,
    Min,
    ValidateNested,
} from 'class-validator';
import { TranslationDto } from './translation.dto';

/**
 * QZ-03 update-quiz payload (PATCH semantics — partial update).
 *
 * Phase 6 Plan 01 — locked contract surface.
 * Consumed by Plan 02 mutations service.
 *
 * D-11 / D-12 — DESTRUCTIVE EDIT detection note:
 *   This DTO does NOT mutate questions or answers, so quiz-level updates are
 *   NOT considered destructive (no version bump required). Question/answer
 *   destructive edits are handled in UpsertQuestionDto / UpsertAnswerDto
 *   (which carry the optional force_confirm_token).
 *
 * Translation upsert semantics:
 *   - Client sends the desired NEW STATE for translations (1..2 entries).
 *   - Service upserts by locale: existing locale → update; missing locale → create.
 *   - Service does NOT auto-delete missing locales (use a dedicated DELETE path
 *     if/when locale deletion is supported — not in this milestone).
 *   - Translation edits do NOT bump version (version is a question/answer guard).
 */
export type UpdateQuizStatus = 'active' | 'inactive';

export class UpdateQuizDto {
    @IsOptional()
    @IsIn(['active', 'inactive'])
    status?: UpdateQuizStatus;

    @IsOptional()
    @IsInt()
    @Min(1)
    category_id?: number | null;

    @IsOptional()
    @IsInt()
    @Min(1)
    subject_id?: number | null;

    /** Seconds. null or 0 = no time limit. */
    @IsOptional()
    @IsInt()
    @Min(0)
    time?: number | null;

    @IsOptional()
    @IsInt()
    @Min(0)
    pass_mark?: number;

    /** null = unlimited attempts. */
    @IsOptional()
    @IsInt()
    @Min(1)
    attempt?: number | null;

    @IsOptional()
    @IsBoolean()
    certificate?: boolean;

    @IsOptional()
    @IsBoolean()
    display_questions_randomly?: boolean;

    @IsOptional()
    @IsInt()
    @Min(0)
    expiry_days?: number | null;

    @IsOptional()
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(2)
    @ValidateNested({ each: true })
    @Type(() => TranslationDto)
    translations?: TranslationDto[];
}
