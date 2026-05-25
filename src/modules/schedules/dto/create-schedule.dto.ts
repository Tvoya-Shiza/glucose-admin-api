import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    ArrayMinSize,
    IsArray,
    IsIn,
    IsInt,
    IsOptional,
    IsString,
    MaxLength,
    Min,
    ValidateNested,
} from 'class-validator';
import { SCHEDULE_KINDS, SCHEDULE_STATUSES, type ScheduleKindFilter, type ScheduleStatusFilter } from './list-schedules.dto';

export class ScheduleItemInputDto {
    @IsIn(SCHEDULE_KINDS as unknown as string[])
    kind!: ScheduleKindFilter;

    @Type(() => Number)
    @IsInt()
    @Min(1)
    ref_id!: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    position?: number;
}

/**
 * Body for POST /admin-api/v1/admin/schedules.
 *
 * Non-admin actors must set curator_id = self (enforced by service). items[] is
 * optional but typically non-empty — a schedule with zero items is allowed as a
 * placeholder "meeting" that will be filled in later.
 */
export class CreateScheduleDto {
    @Type(() => Number)
    @IsInt()
    @Min(1)
    curator_id!: number;

    @Type(() => Number)
    @IsInt()
    @Min(1)
    group_id!: number;

    // Required: every schedule must be bound to a course. The DB column stays
    // nullable for legacy rows, but new writes must specify a course so the
    // items picker + ref validation can scope to it (assertRefsExist).
    @Type(() => Number)
    @IsInt()
    @Min(1)
    course_id!: number;

    @Type(() => Number)
    @IsInt()
    @Min(0)
    start_at!: number;

    @Type(() => Number)
    @IsInt()
    @Min(0)
    end_at!: number;

    @IsOptional()
    @IsString()
    @MaxLength(2000)
    description?: string;

    @IsOptional()
    @IsIn(SCHEDULE_STATUSES as unknown as string[])
    status?: ScheduleStatusFilter;

    @IsOptional()
    @IsArray()
    @ArrayMinSize(0)
    @ArrayMaxSize(50)
    @ValidateNested({ each: true })
    @Type(() => ScheduleItemInputDto)
    items?: ScheduleItemInputDto[];
}
