import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';
import type { CreditDifficulty } from '@shared/credits';

/**
 * Body for POST /admin-api/v1/admin/credit-questions.
 *
 * Supply EXACTLY ONE of `topic_id` (a custom bank topic) or `chapter_item_id`
 * (a course lesson — the service lazily materializes/reuses its lesson-topic).
 * The service enforces the XOR and rejects zero-or-both.
 */
export class CreateCreditQuestionDto {
    @IsOptional()
    @IsString()
    @Matches(/^\d+$/, { message: 'topic_id must be a decimal id string' })
    topic_id?: string;

    /** Alternative to topic_id: tag the question to a course lesson (a chapter item id). */
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    chapter_item_id?: number;

    @IsIn(['A', 'B', 'C'])
    difficulty!: CreditDifficulty;

    /** Rich text (sanitized Tiptap HTML). Server re-sanitizes on write. */
    @IsString()
    @IsNotEmpty()
    @MaxLength(50000)
    question!: string;

    /** Reference answer for the curator — never reaches student payloads (decision 8). */
    @IsString()
    @IsNotEmpty()
    @MaxLength(50000)
    answer!: string;

    /** Optional photo shown WITH the question (relative upload URL). Student-visible. */
    @IsOptional()
    @IsString()
    @MaxLength(2048)
    question_image?: string;

    /** Optional photo shown WITH the reference answer (relative upload URL). Curator-only. */
    @IsOptional()
    @IsString()
    @MaxLength(2048)
    answer_image?: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    score?: number;
}
