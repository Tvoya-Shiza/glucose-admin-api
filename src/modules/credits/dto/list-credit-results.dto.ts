import { Type } from 'class-transformer';
import { IsBooleanString, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import type { CreditSessionStatus } from '@shared/credits';

/**
 * Query DTO for GET /admin-api/v1/admin/credit-results — every conducted zachet
 * result across ALL credits. `search` matches student full_name OR mobile (the
 * «номер»). `date_from`/`date_to` bound finished_at (unix sec). When `status` is
 * omitted the service defaults to finalized attempts (finished + expired).
 */
export class ListCreditResultsDto {
    @IsOptional()
    @IsString()
    @MaxLength(255)
    search?: string;

    @IsOptional()
    @IsIn(['pending', 'in_progress', 'finished', 'expired', 'cancelled'])
    status?: CreditSessionStatus;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    course_id?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    group_id?: number;

    /** 'true' | 'false' — only passed / only failed. */
    @IsOptional()
    @IsBooleanString()
    passed?: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    date_from?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    date_to?: number;

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
