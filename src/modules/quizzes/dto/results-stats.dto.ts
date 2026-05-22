import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Min } from 'class-validator';

/**
 * QZ-10 results-stats query DTO. All fields optional.
 *
 * Trimmed mirror of ListResultsDto:
 *   - Drops: page, page_size, sort, order (no pagination on aggregates).
 *   - Drops: user_id, q (per-user rankings are not a meaningful stats surface).
 *
 * Date-range semantics applied by the service:
 *   - When date_from is omitted, default to (now - 30d).
 *   - When date_to is omitted, default to now.
 *   - Range is clamped to a max 90-day window; if exceeded, date_from is
 *     truncated to (date_to - 90d).
 *   - daily_trend is always day-bucketed inside the applied window.
 *
 * RBAC: same scope as ListResultsDto (admin all, curator narrowed to own
 * groups' members, teacher narrowed to own webinars). For teachers, top_groups
 * always returns []; for curators, an out-of-supervision group_id silently
 * default-denies the whole response.
 */
export class ResultsStatsDto {
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
    group_id?: number;

    @IsOptional()
    @IsIn(['waiting', 'passed', 'failed'])
    status?: 'waiting' | 'passed' | 'failed';

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
}
