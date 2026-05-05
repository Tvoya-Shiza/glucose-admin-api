import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';

/**
 * Phase 9 ANL-01..03 — analytics endpoint query DTO.
 *
 * Endpoint behavior:
 *   - admin-kpi: ignores window_* (the admin endpoint always reports global stats
 *     across fixed windows: 24h DAU, 7d active, 30d completion, current-month
 *     revenue, 12-month trend).
 *   - curator-overview: respects window_days (default 7); window_all=true overrides
 *     window_days to a sentinel "all-time" value (server uses Unix epoch start).
 *   - teacher-overview: ignores window (server uses fixed 7d window for recent
 *     quiz results; pending grading queue has no window).
 *
 * as_role (admin pivot, D-19): admin can pass `as_role=curator|teacher` so the
 * admin-client renders the matching dashboard layout. The pivot is a UX label —
 * the server still scopes aggregations to the actor's own id (admin user pivoting
 * to /curator-overview will see groups they personally supervise, which is empty
 * unless they're listed as supervisor). True identity-impersonation is OUT of
 * scope per D-19 + T-09-04-03.
 */
export class AnalyticsQueryDto {
    @IsOptional()
    @Type(() => Number)
    @IsIn([1, 7, 30])
    window_days?: 1 | 7 | 30;

    @IsOptional()
    @Type(() => Boolean)
    @IsBoolean()
    window_all?: boolean;

    @IsOptional()
    @IsIn(['admin', 'curator', 'teacher'])
    as_role?: 'admin' | 'curator' | 'teacher';
}
