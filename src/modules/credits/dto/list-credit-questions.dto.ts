import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import type { CreditBankStatus, CreditDifficulty } from '@shared/credits';

/**
 * Query DTO for GET /admin-api/v1/admin/credit-questions.
 *
 * `topic_id` + `include_descendants=true` expands the topic's subtree in memory
 * (BFS over the full adjacency list) and filters over the expanded id set.
 * `search` is a LIKE over question AND answer text.
 */
export class ListCreditQuestionsDto {
    @IsOptional()
    @IsString()
    @Matches(/^\d+$/, { message: 'topic_id must be a decimal id string' })
    topic_id?: string;

    @IsOptional()
    @Transform(({ value }) => {
        if (value === true || value === 'true' || value === '1' || value === 1) return true;
        if (value === false || value === 'false' || value === '0' || value === 0) return false;
        return undefined;
    })
    @IsBoolean()
    include_descendants?: boolean;

    @IsOptional()
    @IsIn(['A', 'B', 'C'])
    difficulty?: CreditDifficulty;

    @IsOptional()
    @IsIn(['active', 'archived'])
    status?: CreditBankStatus;

    @IsOptional()
    @IsString()
    @MaxLength(255)
    search?: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(200)
    page_size?: number;
}
