import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * QZ-01 / QZ-02 list-quizzes query DTO. All fields optional.
 *
 * Phase 6 Plan 01 — locked contract surface (D-01..D-03 from CONTEXT).
 * Numeric query string fields are coerced via @Type(() => Number).
 *
 * Default sort: created_at desc. Default page size: 50.
 *
 * Consumed by Plan 02 list controller / list service.
 *
 * Schema-truth notes:
 *   - status enum: QuizStatus = active | inactive (schema line 467; only TWO values, vs courses' four).
 *   - search `q`: matches QuizTranslation.title (any locale) — built in service via OR/some.
 *   - translation_completeness: 'complete' = both ru AND kz translations exist with non-empty title;
 *                               'incomplete' = either is missing or empty (D-03).
 *   - question_count_bucket: discrete buckets to avoid raw count filtering at the DB layer.
 *     Service maps these to `_count: { questions: { ... } }` Prisma fragments.
 *   - badge_id filter: Plan 02 service uses `quiz_badge_items.some.quiz_badge_id` to narrow.
 *   - sort 'title': sorts by joined QuizTranslation.title (ru locale specifically — RU canonical).
 */
export type QuizStatusFilter = 'active' | 'inactive';
export type QuizQuestionCountBucket = 'none' | '1-10' | '11-30' | '31+';
export type QuizSortField = 'created_at' | 'updated_at' | 'title';
export type SortOrder = 'asc' | 'desc';

export class ListQuizzesDto {
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
    @IsIn(['active', 'inactive'])
    status?: QuizStatusFilter;

    /**
     * Phase 22 — filter by public-catalog visibility.
     * URL: `?is_listed=true` or `?is_listed=false`. Omit for "all".
     */
    @IsOptional()
    @Transform(({ value }) => {
        if (value === true || value === 'true' || value === '1' || value === 1) return true;
        if (value === false || value === 'false' || value === '0' || value === 0) return false;
        return undefined;
    })
    @IsBoolean()
    is_listed?: boolean;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    category_id?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    badge_id?: number;

    @IsOptional()
    @IsIn(['none', '1-10', '11-30', '31+'])
    question_count_bucket?: QuizQuestionCountBucket;

    @IsOptional()
    @IsString()
    @MaxLength(100)
    q?: string;

    @IsOptional()
    @IsIn(['created_at', 'updated_at', 'title'])
    sort?: QuizSortField;

    @IsOptional()
    @IsIn(['asc', 'desc'])
    order?: SortOrder;
}
