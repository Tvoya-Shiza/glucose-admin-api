import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    ArrayMinSize,
    IsArray,
    IsBoolean,
    IsIn,
    IsInt,
    IsOptional,
    IsString,
    MaxLength,
    Min,
    ValidateIf,
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

    // Phase 32 — optional/nullable: omit or send null for a GENERAL schedule
    // (applies to every student of the course). A positive id scopes it to a group.
    @IsOptional()
    @ValidateIf((o: CreateScheduleDto) => o.group_id !== null && o.group_id !== undefined)
    @Type(() => Number)
    @IsInt()
    @Min(1)
    group_id?: number | null;

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

    // Rich-text HTML (sanitized server-side before persist). Markup eats into
    // the budget, so the cap is higher than the old plain-text 2000. DB column
    // is TEXT (~65k); keep in sync with the admin-client zod schema.
    @IsOptional()
    @IsString()
    @MaxLength(10000)
    description?: string;

    @IsOptional()
    @IsIn(SCHEDULE_STATUSES as unknown as string[])
    status?: ScheduleStatusFilter;

    // Phase 32 — independent access-gate toggles. Default false (informational
    // event that doesn't lock content). block_before_start: lock while now < start_at.
    // block_after_end: lock while now > end_at.
    @IsOptional()
    @IsBoolean()
    block_before_start?: boolean;

    @IsOptional()
    @IsBoolean()
    block_after_end?: boolean;

    @IsOptional()
    @IsArray()
    @ArrayMinSize(0)
    @ArrayMaxSize(50)
    @ValidateNested({ each: true })
    @Type(() => ScheduleItemInputDto)
    items?: ScheduleItemInputDto[];
}
