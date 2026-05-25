import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    ArrayMinSize,
    IsArray,
    IsBoolean,
    IsIn,
    IsInt,
    IsOptional,
    IsString,
    Length,
    MaxLength,
    Min,
    ValidateNested,
} from 'class-validator';

/**
 * QZ-04 upsert-answer payload (single create/update — POST or PATCH).
 *
 * Phase 6 Plan 01 — locked contract surface (D-07 / D-09 / D-11 / D-12).
 * Consumed by Plan 05 questions/answers service.
 *
 * Schema-truth notes:
 *   - QuizQuestionAnswer.parent_id is `Int? @db.UnsignedInt` (line 595) — self-FK to id.
 *   - QuizQuestionAnswer.correct is `Boolean @default(false)` (line 597) — REQUIRED here.
 *   - QuizQuestionAnswer.image is `String? @db.Text` — Phase 5 upload-token URL.
 *   - QuizQuestionAnswerTranslation.title is `String @db.Text` — capped at 1000 here.
 *   - There is NO `order` column on QuizQuestionAnswer — answer ordering is by id ASC for v1.
 *     Editor reorder is visual-only (D-09 deferred per Plan 05's threat model).
 *
 * `parent_id` semantics (D-07 — IDENTIFICATIVE PAIR LINK):
 *   - parent question.type !== 'identificative' → MUST be null/undefined.
 *   - parent question.type === 'identificative':
 *       - LEFT-side anchor row → parent_id is null.
 *       - RIGHT-side match row → parent_id is the LEFT-side answer.id.
 *   - Plan 05's editor renders two columns from this FK: each LEFT row + its RIGHT match.
 *
 * `force_confirm_token` (D-11..D-14):
 *   - Same lifecycle as upsert-question.dto.ts. Plan 05 verifier checks only when the
 *     answer mutation is destructive (changing correctness, changing translation title,
 *     or delete via the dedicated DELETE handler).
 */
export type UpsertAnswerLocale = 'kz';

export class UpsertAnswerTranslationDto {
    // 'ru' accepted for backward compatibility; service filters RU out before persisting.
    @IsIn(['ru', 'kz'])
    locale!: 'ru' | 'kz';

    @IsString()
    @Length(1, 1000)
    title!: string;
}

export class UpsertAnswerDto {
    /** Omit on create. Required on update. */
    @IsOptional()
    @IsInt()
    @Min(1)
    id?: number;

    @IsInt()
    @Min(1)
    question_id!: number;

    /**
     * Legacy 1:1 pair link for identificative (pre-Phase-24). Kept on the DTO
     * for backward compatibility but the new ENT-format editor leaves this as
     * null and uses match_target_id instead.
     */
    @IsOptional()
    @IsInt()
    @Min(1)
    parent_id?: number | null;

    /**
     * Phase 24 ENT identificative format. For prompt rows (LEFT), this is the id
     * of the correct option (RIGHT, shared pool) within the SAME question. For
     * option rows and non-identificative answer rows, this MUST be null.
     *
     * Service validates: target answer exists, belongs to the same question_id,
     * and itself has match_target_id == null (no chained references).
     *
     * Changing this value on an existing prompt is treated as destructive
     * (force_confirm_token gate) — same as changing `correct`.
     */
    @IsOptional()
    @IsInt()
    @Min(1)
    match_target_id?: number | null;

    @IsBoolean()
    correct!: boolean;

    @IsOptional()
    @IsString()
    @MaxLength(1024)
    image?: string | null;

    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(2)
    @ValidateNested({ each: true })
    @Type(() => UpsertAnswerTranslationDto)
    translations!: UpsertAnswerTranslationDto[];

    @IsOptional()
    @IsString()
    @MaxLength(2048)
    force_confirm_token?: string;
}
