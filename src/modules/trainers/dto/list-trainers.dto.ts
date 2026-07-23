import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * Phase 38 — list-trainers query DTO. All fields optional.
 *
 * Default sort: created_at desc (fixed — no sort param on v1). Default page size: 50.
 *
 * Schema-truth notes:
 *   - publish_status is DERIVED, not a column: trainer_settings has no publish_status
 *     field (phase-38 MANUAL reuse decision — `Quizzes.status` IS the publish state).
 *     'public' ⇔ quizzes.status='active', 'hidden' ⇔ quizzes.status='inactive'.
 *   - search `q` matches the kz QuizTranslation.title (contains, case-insensitive via
 *     MySQL collation) — same as the legacy quizzes list.
 *   - course_id narrows via trainer_courses.some.webinar_id.
 */
export type TrainerPublishStatus = 'hidden' | 'public';

export class ListTrainersDto {
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
    @IsString()
    @MaxLength(100)
    q?: string;

    @IsOptional()
    @IsIn(['hidden', 'public'])
    publish_status?: TrainerPublishStatus;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    category_id?: number;

    /** Webinar (course) id linked via trainer_courses. */
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    course_id?: number;
}
