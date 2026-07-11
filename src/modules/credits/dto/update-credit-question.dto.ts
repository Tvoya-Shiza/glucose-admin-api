import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';
import type { CreditBankStatus, CreditDifficulty } from '@shared/credits';

/**
 * Body for PATCH /admin-api/v1/admin/credit-questions/:id — every field optional.
 *
 * To re-tag the question, supply EITHER `topic_id` (custom topic) OR
 * `chapter_item_id` (course lesson) — never both. Omitting both leaves the tag
 * unchanged. The service enforces the "not both" rule.
 */
export class UpdateCreditQuestionDto {
    @IsOptional()
    @IsString()
    @Matches(/^\d+$/, { message: 'topic_id must be a decimal id string' })
    topic_id?: string;

    /** Alternative to topic_id: re-tag the question to a course lesson (a chapter item id). */
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    chapter_item_id?: number;

    @IsOptional()
    @IsIn(['A', 'B', 'C'])
    difficulty?: CreditDifficulty;

    @IsOptional()
    @IsString()
    @IsNotEmpty()
    @MaxLength(50000)
    question?: string;

    @IsOptional()
    @IsString()
    @IsNotEmpty()
    @MaxLength(50000)
    answer?: string;

    /** Photo shown WITH the question. Empty string clears it. Student-visible. */
    @IsOptional()
    @IsString()
    @MaxLength(2048)
    question_image?: string;

    /** Photo shown WITH the reference answer. Empty string clears it. Curator-only. */
    @IsOptional()
    @IsString()
    @MaxLength(2048)
    answer_image?: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    score?: number;

    @IsOptional()
    @IsIn(['active', 'archived'])
    status?: CreditBankStatus;
}
