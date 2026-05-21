import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Min } from 'class-validator';

/**
 * Query DTO for GET /admin-api/v1/admin/users/analytics.
 *
 * `range` is the primary control — presets compute (from, to) server-side. When
 * `range='custom'`, `from` + `to` are required (Unix seconds). `bucket` is
 * optional; when omitted the service picks a bucket size that produces a sane
 * number of points for the chosen range (≤120д→day, ≤400д→week, else month).
 */
export class UsersAnalyticsQueryDto {
    @IsOptional()
    @IsIn(['7d', '30d', '90d', '365d', 'custom'])
    range?: '7d' | '30d' | '90d' | '365d' | 'custom';

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    from?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    to?: number;

    @IsOptional()
    @IsIn(['day', 'week', 'month'])
    bucket?: 'day' | 'week' | 'month';
}

export class UsersAnalyticsResponseDto {
    totals!: {
        total_users: number;
        new_users_in_range: number;
        active_users_30d: number;
    };
    by_status!: { active: number; inactive: number; pending: number };
    by_role!: Array<{ role_name: string; count: number }>;
    registrations!: Array<{ bucket: number; count: number }>;
    range!: { from: number; to: number; bucket: 'day' | 'week' | 'month' };
    generated_at!: number;
}
