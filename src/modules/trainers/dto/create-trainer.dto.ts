import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * Phase 38 — create-trainer body DTO.
 *
 * Field → storage mapping (phase-38 MANUAL reuse decisions — trainers are quizzes rows
 * plus a trainer_settings satellite; NO parallel publish/attempt-limit/shuffle columns):
 *   - title              → QuizTranslation (locale='kz')
 *   - category_id        → Quizzes.category_id
 *   - shuffle_questions  → Quizzes.display_questions_randomly
 *   - attempts_limit     → Quizzes.attempt (0 = unlimited, stored as NULL)
 *   - timer_enabled / seconds_per_question / shuffle_answers / flashcards_enabled /
 *     background_image / available_from / available_to → trainer_settings
 *   - course_ids         → trainer_courses (quiz_id, webinar_id) link rows
 *
 * Cross-field rules enforced in the SERVICE (class-validator cannot see siblings):
 *   - seconds_per_question is REQUIRED when timer_enabled=true.
 *   - available_from < available_to when both are present.
 *   - every course_ids entry must reference an existing (non-deleted) webinar.
 */
export class CreateTrainerDto {
    @IsString()
    @MaxLength(500)
    title!: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    category_id?: number;

    /** Предмет (Quizzes.subject_id) — по нему ученик фильтрует список тренажёров. */
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    subject_id?: number;

    /** Тема оформления по умолчанию (trainer_settings.theme_id). */
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    theme_id?: number;

    @IsOptional()
    @IsBoolean()
    timer_enabled?: boolean;

    /** Seconds per question; required when timer_enabled=true (validated in service). */
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(5)
    @Max(600)
    seconds_per_question?: number;

    @IsOptional()
    @IsBoolean()
    shuffle_questions?: boolean;

    @IsOptional()
    @IsBoolean()
    shuffle_answers?: boolean;

    @IsOptional()
    @IsBoolean()
    flashcards_enabled?: boolean;

    /** 0 = unlimited (stored as NULL in Quizzes.attempt). */
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    attempts_limit?: number;

    @IsOptional()
    @IsString()
    @MaxLength(512)
    background_image?: string;

    /** Unix seconds. Must be < available_to when both present (validated in service). */
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    available_from?: number;

    /** Unix seconds. */
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    available_to?: number;

    /** Webinar ids to link via trainer_courses. Each verified to exist (non-deleted). */
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(50)
    @Type(() => Number)
    @IsInt({ each: true })
    @Min(1, { each: true })
    course_ids?: number[];
}
