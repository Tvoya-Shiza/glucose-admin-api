import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

/**
 * Query DTO for GET /admin-api/v1/admin/schedules/analytics.
 *
 * Optional [from, to] window — if omitted, defaults to current month at the service.
 */
export class AnalyticsSchedulesDto {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    from?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    to?: number;
}
