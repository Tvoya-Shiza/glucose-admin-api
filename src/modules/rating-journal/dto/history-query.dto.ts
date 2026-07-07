import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

/**
 * Query for GET /admin-api/v1/admin/rating-journal/cells/history — the edit log
 * (кто/когда/было→стало). Filterable by column and/or student; paginated.
 */
export class HistoryQueryDto {
    @IsOptional()
    @IsString()
    @Matches(/^\d+$/, { message: 'column_id must be a decimal id string' })
    column_id?: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    student_id?: number;

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
