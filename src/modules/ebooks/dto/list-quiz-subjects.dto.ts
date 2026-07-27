import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * Phase 43 — list-quiz-subjects query DTO. All fields optional.
 *
 * `q` matches the subject title in any locale (contains, case-insensitive via the
 * MySQL collation). Default page size 50, capped at 200 — same contract as
 * ListPublishersDto so the admin UI can reuse its combobox.
 */
export class ListQuizSubjectsDto {
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
}
