import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * Phase 38 — body DTO for POST /admin-api/v1/admin/trainer-results/export.
 *
 * Mirrors ListTrainerResultsDto's filter shape so URL state from the results page
 * round-trips into the export call exactly (same posture as ExportUsersDto).
 * `format` is the only required field; page/page_size are intentionally omitted —
 * exports respect scope + filters but never paginate (50k server-side cap).
 */
export class ExportTrainerResultsDto {
    @IsIn(['csv', 'xlsx'])
    format!: 'csv' | 'xlsx';

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

    @IsOptional()
    @IsIn(['started_at', 'score'])
    sort?: 'started_at' | 'score';

    @IsOptional()
    @IsIn(['asc', 'desc'])
    order?: 'asc' | 'desc';
}
