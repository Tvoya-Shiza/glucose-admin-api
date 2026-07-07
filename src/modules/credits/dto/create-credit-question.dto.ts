import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Min } from 'class-validator';
import type { CreditDifficulty } from '@shared/credits';

/** Body for POST /admin-api/v1/admin/credit-questions. */
export class CreateCreditQuestionDto {
    @IsString()
    @Matches(/^\d+$/, { message: 'topic_id must be a decimal id string' })
    topic_id!: string;

    @IsIn(['A', 'B', 'C'])
    difficulty!: CreditDifficulty;

    @IsString()
    @IsNotEmpty()
    question!: string;

    /** Reference answer for the curator — never reaches student payloads (decision 8). */
    @IsString()
    @IsNotEmpty()
    answer!: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    score?: number;
}
