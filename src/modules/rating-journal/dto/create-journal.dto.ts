import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/**
 * Body for POST /admin-api/v1/admin/rating-journal — creates a journal for an
 * explicit (group, course) pair (a Group has no course_id; the operator picks
 * both). Idempotent: an existing (group, course) journal is returned instead.
 */
export class CreateJournalDto {
    @Type(() => Number)
    @IsInt()
    @Min(1)
    group_id!: number;

    @Type(() => Number)
    @IsInt()
    @Min(1)
    course_id!: number;

    @IsOptional()
    @IsString()
    @MaxLength(255)
    title?: string;
}
