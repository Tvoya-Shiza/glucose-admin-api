import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export const SCHEDULE_STATUSES = ['draft', 'scheduled', 'in_progress', 'completed', 'cancelled'] as const;
export type ScheduleStatusFilter = (typeof SCHEDULE_STATUSES)[number];

export const SCHEDULE_KINDS = ['lesson', 'quiz', 'assignment', 'file'] as const;
export type ScheduleKindFilter = (typeof SCHEDULE_KINDS)[number];

export type ScheduleSortField = 'start_at' | 'created_at';
export type SortOrder = 'asc' | 'desc';

/**
 * Query DTO for GET /admin-api/v1/admin/schedules.
 *
 * Filters compose: q (description), status, curator_id, group_id, course_id, kind,
 * [from..to] intersect with [start_at..end_at]. Non-admin actors are scope-narrowed
 * to curator_id=self regardless of the curator_id filter.
 */
export class ListSchedulesDto {
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

    @IsOptional()
    @IsString()
    @MaxLength(100)
    q?: string;

    @IsOptional()
    @IsIn(SCHEDULE_STATUSES as unknown as string[])
    status?: ScheduleStatusFilter;

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
    @IsIn(SCHEDULE_KINDS as unknown as string[])
    kind?: ScheduleKindFilter;

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

    @IsOptional()
    @IsIn(['start_at', 'created_at'])
    sort?: ScheduleSortField;

    @IsOptional()
    @IsIn(['asc', 'desc'])
    order?: SortOrder;
}
