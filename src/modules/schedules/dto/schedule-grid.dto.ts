import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    IsArray,
    IsBoolean,
    IsIn,
    IsInt,
    IsOptional,
    Min,
    ValidateIf,
    ValidateNested,
} from 'class-validator';
import { SCHEDULE_KINDS, type ScheduleKindFilter } from './list-schedules.dto';

/**
 * One node of the per-course schedule grid. A node is a single course-structure
 * target with its own access window + toggles:
 *   - a module/chapter  → kind='lesson', ref_id=chapter.id  (chapter-level rule)
 *   - a lesson/item     → kind in quiz|assignment|file, ref_id=resource id (item-level)
 *
 * `id` is the existing single-item `lesson_schedules` row backing this node (when
 * the node already has a rule for the selected scope); omit it to create a new row.
 */
export class ScheduleGridNodeDto {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    id?: number;

    @IsIn(SCHEDULE_KINDS as unknown as string[])
    kind!: ScheduleKindFilter;

    @Type(() => Number)
    @IsInt()
    @Min(1)
    ref_id!: number;

    @Type(() => Number)
    @IsInt()
    @Min(0)
    start_at!: number;

    @Type(() => Number)
    @IsInt()
    @Min(0)
    end_at!: number;

    @IsOptional()
    @IsBoolean()
    block_before_start?: boolean;

    @IsOptional()
    @IsBoolean()
    block_after_end?: boolean;
}

/**
 * Body for PUT /admin-api/v1/admin/courses/:id/schedule-grid.
 *
 * Declarative bulk save of the access-window grid for a course + scope:
 *   - `group_id` is the scope for NEW rows (null/omitted = general schedule).
 *   - `upserts` create (no id) or update (with id) one single-item schedule each.
 *   - `deletes` soft-delete schedule rows whose node was cleared.
 *
 * Every referenced node must belong to the course in the URL (validated server-side).
 */
export class SaveScheduleGridDto {
    @IsOptional()
    @ValidateIf((o: SaveScheduleGridDto) => o.group_id !== null && o.group_id !== undefined)
    @Type(() => Number)
    @IsInt()
    @Min(1)
    group_id?: number | null;

    @IsArray()
    @ArrayMaxSize(500)
    @ValidateNested({ each: true })
    @Type(() => ScheduleGridNodeDto)
    upserts!: ScheduleGridNodeDto[];

    @IsOptional()
    @IsArray()
    @ArrayMaxSize(500)
    @Type(() => Number)
    @IsInt({ each: true })
    deletes?: number[];
}
