import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Min } from 'class-validator';
import type { CreditBankStatus, CreditDifficulty } from '@shared/credits';

/** Body for PATCH /admin-api/v1/admin/credit-questions/:id — every field optional. */
export class UpdateCreditQuestionDto {
    @IsOptional()
    @IsString()
    @Matches(/^\d+$/, { message: 'topic_id must be a decimal id string' })
    topic_id?: string;

    @IsOptional()
    @IsIn(['A', 'B', 'C'])
    difficulty?: CreditDifficulty;

    @IsOptional()
    @IsString()
    @IsNotEmpty()
    question?: string;

    @IsOptional()
    @IsString()
    @IsNotEmpty()
    answer?: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    score?: number;

    @IsOptional()
    @IsIn(['active', 'archived'])
    status?: CreditBankStatus;
}
