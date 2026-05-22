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
import type { CourseStatusFilter } from './list-courses.dto';

/**
 * CRS-04 update-course payload (PATCH).
 *
 * Phase 5 Plan 01 locked contract surface.
 *
 * Update path supports partial:
 *   - slug?, status?, category_id?, image_cover?, thumbnail?, translations?
 *
 * Notes:
 *   - DO NOT include `teacher_id` here — teacher reassignment goes through ChangeTeacherDto
 *     (admin-only, audited separately, validates target user has role_name='teacher').
 *   - `translations[]` is upserted by locale in Plan 03 service (find-then-create/update).
 *     Schema has NO @@unique([webinar_id, locale]) so the service handles dedup.
 *   - `status` allows ALL four values including 'inactive' (vs CreateCourseDto which excludes 'inactive').
 *   - `category_id: null` clears the assignment (Webinar.category_id is nullable on schema, line 808).
 */
export class UpdateCourseDto {
    @IsOptional()
    @IsString()
    @Length(3, 255)
    slug?: string;

    @IsOptional()
    @IsIn(['active', 'pending', 'is_draft', 'inactive'])
    status?: CourseStatusFilter;

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

    @IsOptional()
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(2)
    @ValidateNested({ each: true })
    @Type(() => TranslationDto)
    translations?: TranslationDto[];

    /**
     * Pricing — Phase 13. When toggled true the service requires price + access_days
     * and creates/updates a single WebinarPrices row. When toggled false the service
     * removes any existing WebinarPrices rows for the course (idempotent).
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

    /**
     * Phase 16 — toggle strict completion check for the course.
     * Independent of `is_paid`: a paid course can opt out of strictness, and a free
     * course can opt in. Admin-client defaults the checkbox from `is_paid` for UX,
     * but the field is honoured as sent.
     */
    @IsOptional()
    @IsBoolean()
    strict_progress?: boolean;

    /**
     * Estimated time to complete the course, in MINUTES (Webinar.duration column on
     * schema). Operator-supplied — there is no automatic aggregation from chapter
     * items yet. Pass `null` to clear. UI formats this as "X сағ Y мин" on display.
     * Capped at 100_000 minutes (~70 days of pure study time) as a safety guard.
     */
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    duration?: number | null;
}
