import { Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import type { CreditStatus } from '@shared/credits';

/**
 * Body for PATCH /admin-api/v1/admin/credits/:id — all CreateCreditDto fields
 * optional plus `status`. `lesson_item_ids`, when provided, REPLACES the link
 * set (diff-wise: missing links removed, new links added).
 */
export class UpdateCreditDto {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    course_id?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    chapter_id?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    group_id?: number;

    @IsOptional()
    @IsString()
    @IsNotEmpty()
    @MaxLength(255)
    title?: string;

    @IsOptional()
    @IsString()
    description?: string | null;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    scheduled_at?: number | null;

    @IsOptional()
    @IsIn(['draft', 'active', 'archived'])
    status?: CreditStatus;

    @IsOptional()
    @IsArray()
    @Type(() => Number)
    @IsInt({ each: true })
    @Min(1, { each: true })
    lesson_item_ids?: number[];
}
