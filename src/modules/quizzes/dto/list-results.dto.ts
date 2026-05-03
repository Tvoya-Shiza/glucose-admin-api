import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * QZ-08 list-quiz-results query DTO. All fields optional.
 *
 * Phase 6 Plan 01 — locked contract surface (D-22 + D-23).
 * Consumed by Plan 07 results controller/service.
 *
 * Default sort: created_at desc. Default page size: 50.
 *
 * Schema-truth notes:
 *   - QuizResult.status is QuizResultStatus enum: 'waiting'|'passed'|'failed' (line 629).
 *   - QuizResult.created_at is `Int` (Unix s) — line 630. date_from/date_to filters
 *     are Unix seconds.
 *   - QuizResult.user_id / .quiz_id are NOT NULL — surfaced as user_id / quiz_id filters.
 *   - search `q` matches User.full_name OR User.email (joined) — Plan 07 service builds OR fragment.
 *
 * RBAC scope: Plan 07 calls buildScopeWhere(actor, QUIZ_RESULT_SCOPE_RULES) for admin
 * + curator. For TEACHER actors, Plan 07 uses the manual two-step lookup documented in
 * quizzes.scope.ts (the placeholder in QUIZ_RESULT_SCOPE_RULES denies all by default).
 */
export type QuizResultStatusFilter = 'waiting' | 'passed' | 'failed';
export type QuizResultsSortField = 'created_at';
export type SortOrder = 'asc' | 'desc';

export class ListResultsDto {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    quiz_id?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    badge_id?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    user_id?: number;

    @IsOptional()
    @IsIn(['waiting', 'passed', 'failed'])
    status?: QuizResultStatusFilter;

    /** Unix seconds. */
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    date_from?: number;

    /** Unix seconds. */
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    date_to?: number;

    @IsOptional()
    @IsString()
    @MaxLength(100)
    q?: string;

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
    @IsIn(['created_at'])
    sort?: QuizResultsSortField;

    @IsOptional()
    @IsIn(['asc', 'desc'])
    order?: SortOrder;
}
