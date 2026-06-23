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
import { SCHEDULE_STATUSES, type ScheduleStatusFilter } from './list-schedules.dto';
import { ScheduleItemInputDto } from './create-schedule.dto';

/**
 * Body for PATCH /admin-api/v1/admin/schedules/:id.
 *
 * Partial. When `items` is provided, the items list is FULL-REPLACED (delete
 * existing rows + create new). When `items` is omitted, the existing items are
 * left untouched. curator_id is not editable through this surface — admins
 * delete + recreate to re-assign ownership.
 */
export class UpdateScheduleDto {
    // Phase 32 — explicit `null` converts a group schedule to GENERAL; omitted
    // leaves the existing group unchanged; a positive id re-scopes to that group.
    @IsOptional()
    @ValidateIf((o: UpdateScheduleDto) => o.group_id !== null && o.group_id !== undefined)
    @Type(() => Number)
    @IsInt()
    @Min(1)
    group_id?: number | null;

    // course_id is partial-optional (PATCH), but `null` is no longer accepted —
    // once bound, a schedule cannot have its course detached. Use create-then-
    // delete to fully re-bind. Legacy rows with course_id=NULL remain readable
    // (handled in list/detail services); on edit, the client forces a new value.
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    course_id?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    start_at?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    end_at?: number;

    // Rich-text HTML (sanitized server-side before persist). See create DTO for
    // the rationale behind the higher cap. Keep in sync with the admin-client.
    @IsOptional()
    @IsString()
    @MaxLength(10000)
    description?: string | null;

    @IsOptional()
    @IsIn(SCHEDULE_STATUSES as unknown as string[])
    status?: ScheduleStatusFilter;

    // Phase 32 — independent access-gate toggles (omitted = unchanged).
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
