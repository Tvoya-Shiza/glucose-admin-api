import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

/** Query DTO for GET /admin-api/v1/admin/credits/calendar — scheduled_at ∈ [from, to], unix sec. */
export class CalendarCreditsDto {
    @Type(() => Number)
    @IsInt()
    @Min(0)
    from!: number;

    @Type(() => Number)
    @IsInt()
    @Min(0)
    to!: number;
}
