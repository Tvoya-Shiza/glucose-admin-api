import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { SCHEDULE_STATUSES, type ScheduleStatusFilter } from './list-schedules.dto';

/**
 * Query DTO for GET /admin-api/v1/admin/schedules/calendar.
 *
 * Returns schedules whose [start_at, end_at] intersects [from, to] —
 * the calendar grid's visible window. No pagination — the client expects
 * a complete answer for the window. `from` and `to` are required.
 */
export class CalendarSchedulesDto {
    @Type(() => Number)
    @IsInt()
    @Min(0)
    from!: number;

    @Type(() => Number)
    @IsInt()
    @Min(0)
    to!: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    curator_id?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    group_id?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    course_id?: number;

    @IsOptional()
    @IsIn(SCHEDULE_STATUSES as unknown as string[])
    status?: ScheduleStatusFilter;
}
