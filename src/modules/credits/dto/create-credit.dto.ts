import { Type } from 'class-transformer';
import { IsArray, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/**
 * Body for POST /admin-api/v1/admin/credits.
 * chapter must belong to the course, lesson_item_ids to the chapter; a non-admin
 * creator must be the group's supervisor (validated in the service).
 */
export class CreateCreditDto {
    @Type(() => Number)
    @IsInt()
    @Min(1)
    course_id!: number;

    @Type(() => Number)
    @IsInt()
    @Min(1)
    chapter_id!: number;

    @Type(() => Number)
    @IsInt()
    @Min(1)
    group_id!: number;

    @IsString()
    @IsNotEmpty()
    @MaxLength(255)
    title!: string;

    @IsOptional()
    @IsString()
    description?: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    scheduled_at?: number;

    /** Chapter-item ids (numbers — NOT credit-domain BigInt ids). */
    @IsOptional()
    @IsArray()
    @Type(() => Number)
    @IsInt({ each: true })
    @Min(1, { each: true })
    lesson_item_ids?: number[];
}
