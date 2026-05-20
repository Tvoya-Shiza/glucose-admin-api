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
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    group_id?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    course_id?: number | null;

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

    @IsOptional()
    @IsString()
    @MaxLength(2000)
    description?: string | null;

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
