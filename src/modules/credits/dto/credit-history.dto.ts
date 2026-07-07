import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import type { CreditSessionStatus } from '@shared/credits';

/** Query DTO for GET /admin-api/v1/admin/credits/:id/history. */
export class CreditHistoryDto {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    student_id?: number;

    @IsOptional()
    @IsIn(['pending', 'in_progress', 'finished', 'expired', 'cancelled'])
    status?: CreditSessionStatus;

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
