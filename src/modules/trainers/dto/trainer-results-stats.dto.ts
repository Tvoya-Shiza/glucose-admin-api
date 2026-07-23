import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * Phase 38 — trainer-results stats query DTO.
 *
 * Trimmed mirror of ListTrainerResultsDto: drops page/page_size/sort/order (no
 * pagination on aggregates) but keeps EVERY filter so the stats header and the
 * list below it always agree — both go through buildTrainerResultsWhere.
 */
export class TrainerResultsStatsDto {
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

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    course_id?: number;

    @IsOptional()
    @IsIn(['in_progress', 'paused', 'finished', 'abandoned'])
    status?: 'in_progress' | 'paused' | 'finished' | 'abandoned';

    @IsOptional()
    @IsIn(['trainer', 'flashcards'])
    mode?: 'trainer' | 'flashcards';

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
}
