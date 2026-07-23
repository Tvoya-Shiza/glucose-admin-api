import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * Phase 38 — list-trainer-results query DTO. All fields optional.
 *
 * Default sort: started_at desc. Default page size: 50 (max 200).
 *
 * Schema-truth notes:
 *   - TrainerAttempt.status: in_progress | paused | finished | abandoned.
 *   - TrainerAttempt.mode: trainer | flashcards (flashcards rows exist only if the
 *     student API ever persists them; the filter is future-proof either way).
 *   - date_from/date_to filter on finished_at (unix sec) — unfinished attempts have
 *     finished_at NULL and drop out of a date-filtered view by design.
 *   - search `q` matches User.full_name OR User.mobile (joined contains).
 *   - course_id narrows via the trainer's trainer_courses link subquery.
 *
 * RBAC scope: buildTrainerResultsWhere applies TRAINER_RESULT_SCOPE_RULES —
 * admin all, curator narrowed to supervised groups' students (an out-of-supervision
 * group_id silently default-denies), teacher narrowed to trainers linked to own
 * webinars via the manual two-step lookup (zero webinars → default-deny).
 */
export type TrainerAttemptStatusFilter = 'in_progress' | 'paused' | 'finished' | 'abandoned';
export type TrainerAttemptModeFilter = 'trainer' | 'flashcards';
export type TrainerResultsSortField = 'started_at' | 'score';
export type SortOrder = 'asc' | 'desc';

export class ListTrainerResultsDto {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    trainer_id?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    user_id?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    group_id?: number;

    /** Webinar (course) id — narrows via trainer_courses subquery. */
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    course_id?: number;

    @IsOptional()
    @IsIn(['in_progress', 'paused', 'finished', 'abandoned'])
    status?: TrainerAttemptStatusFilter;

    @IsOptional()
    @IsIn(['trainer', 'flashcards'])
    mode?: TrainerAttemptModeFilter;

    /** Unix seconds (on finished_at). */
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    date_from?: number;

    /** Unix seconds (on finished_at). */
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
    @IsIn(['started_at', 'score'])
    sort?: TrainerResultsSortField;

    @IsOptional()
    @IsIn(['asc', 'desc'])
    order?: SortOrder;

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
}
