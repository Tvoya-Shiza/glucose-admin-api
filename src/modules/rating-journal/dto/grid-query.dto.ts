import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

/**
 * Query for GET /admin-api/v1/admin/rating-journal/grid — resolves (or lazily
 * creates) the journal for a (group, course) pair and returns the full grid.
 * group_id → groups.id (unsigned INT); course_id → webinars.id (signed INT).
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
}
