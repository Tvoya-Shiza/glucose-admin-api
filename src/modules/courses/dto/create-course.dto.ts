import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    ArrayMinSize,
    IsArray,
    IsBoolean,
    IsIn,
    IsInt,
    IsNumber,
    IsOptional,
    IsString,
    Length,
    MaxLength,
    Min,
    ValidateNested,
} from 'class-validator';
import { TranslationDto } from './translation.dto';

/**
 * CRS-04 create-course payload.
 *
 * Phase 5 Plan 01 locked contract surface.
 *
 * Schema-truth notes (carried into Plan 03 mutations service):
 *   - status on create excludes 'inactive' (use update path to deactivate).
 *   - Webinar.creator_id is set server-side from `actor.id` — NOT in this DTO.
 *   - Webinar.image_cover and Webinar.thumbnail are NOT NULL on schema (lines 813-814).
 *     Service defaults missing values to '' before insert.
 *   - type defaults to 'course' (schema line 809: WebinarType @default(course)).
 *   - At least 1 translation required (CONTEXT D-03 wants both ru+kz for completeness,
 *     but a single locale is permitted on initial create — completeness badge will say 'incomplete').
 *
 * Note: do NOT include teacher reassignment here — use ChangeTeacherDto for an existing course.
 */
export type CreateCourseStatus = 'active' | 'pending' | 'is_draft';
export type CreateCourseType = 'webinar' | 'course' | 'text_lesson';

export class CreateCourseDto {
    @IsString()
    @Length(3, 255)
    slug!: string;

    @IsOptional()
    @IsIn(['webinar', 'course', 'text_lesson'])
    type?: CreateCourseType;

    @IsIn(['active', 'pending', 'is_draft'])
    status!: CreateCourseStatus;

    @IsInt()
    @Min(1)
    teacher_id!: number;

    @IsOptional()
    @IsInt()
    @Min(1)
    category_id?: number | null;

    @IsOptional()
    @IsString()
    @MaxLength(255)
    image_cover?: string;

    @IsOptional()
    @IsString()
    @MaxLength(255)
    thumbnail?: string;

    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(2)
    @ValidateNested({ each: true })
    @Type(() => TranslationDto)
    translations!: TranslationDto[];

    /**
     * Pricing — Phase 13 (`is_paid` flag).
     * When `is_paid=true`, `price` and `access_days` are required at the service layer.
     * When `is_paid=false`, both are ignored (and any existing WebinarPrices row is
     * cleaned up on update).
     */
    @IsOptional()
    @IsBoolean()
    is_paid?: boolean;

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    price?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    access_days?: number;
}
