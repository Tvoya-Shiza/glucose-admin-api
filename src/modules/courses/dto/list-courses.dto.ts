import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * CRS-01 / CRS-02 list-courses query DTO. All fields optional.
 *
 * Phase 5 Plan 01 locked contract surface (D-01..D-04 from CONTEXT).
 * Numeric query string fields are coerced via @Type(() => Number).
 *
 * Default sort: created_at desc (CONTEXT D-04). Default page size: 50.
 *
 * Schema-truth notes (carried into Plan 03 list service):
 *   - status enum: WebinarStatus = active | pending | is_draft | inactive (schema line 60).
 *   - search `q`: matches WebinarTranslations.title (any locale) AND Webinar.slug — built in service via OR/some.
 *   - translation_completeness: 'complete' = both ru AND kz translations exist with non-empty title;
 *                               'incomplete' = either is missing or empty (per CONTEXT D-03).
 *   - sort 'teacher': sorts by joined User.full_name through Webinar.teacher relation (schema line 826).
 */
export type CourseStatusFilter = 'active' | 'pending' | 'is_draft' | 'inactive';
export type TranslationCompleteness = 'complete' | 'incomplete';
export type CourseSortField = 'created_at' | 'updated_at' | 'teacher' | 'slug';
export type SortOrder = 'asc' | 'desc';

export class ListCoursesDto {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(200)
    page_size?: number;

    @IsOptional()
    @IsIn(['active', 'pending', 'is_draft', 'inactive'])
    status?: CourseStatusFilter;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    teacher_id?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    category_id?: number;

    @IsOptional()
    @IsIn(['complete', 'incomplete'])
    translation_completeness?: TranslationCompleteness;

    @IsOptional()
    @IsString()
    @MaxLength(200)
    q?: string;

    @IsOptional()
    @IsIn(['created_at', 'updated_at', 'teacher', 'slug'])
    sort?: CourseSortField;

    @IsOptional()
    @IsIn(['asc', 'desc'])
    order?: SortOrder;
}
