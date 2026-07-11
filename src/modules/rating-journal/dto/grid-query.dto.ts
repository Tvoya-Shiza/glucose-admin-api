import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

/**
 * Query for GET /admin-api/v1/admin/rating-journal/grid — resolves (or lazily
 * creates) the journal for a (group, course) pair and returns the full grid.
 * group_id → groups.id (unsigned INT); course_id → webinars.id (signed INT).
 *
 * date_from / date_to (unix sec, inclusive) — optional calendar filter (item 5):
 * when set, only cells whose grade was entered/edited within the range (per the
 * append-only edit log) are shown and counted; the rest render empty.
 */
export class GridQueryDto {
    @Type(() => Number)
    @IsInt()
    @Min(1)
    group_id!: number;

    @Type(() => Number)
    @IsInt()
    @Min(1)
    course_id!: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    date_from?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    date_to?: number;
}
