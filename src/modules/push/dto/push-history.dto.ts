import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * Phase 8 Plan 03 — push history list query DTO (PSH-03).
 *
 * Filters (D-11):
 *   - user_id       (numeric narrowing)
 *   - trigger_type  ('admin.broadcast' | 'admin.scheduled' | 'admin.test' | 'auto.inactivity' | ...)
 *   - success       (boolean)
 *   - date_from / date_to (Unix seconds)
 *
 * Pagination defaults: page=1, page_size=25 (cap 100).
 *
 * RBAC scoping is applied SERVER-SIDE in PushHistoryService — admin sees all,
 * curator/teacher narrow per PUSH_SCOPE_RULES (Plan 01). Clients cannot widen
 * their scope by omitting the `user_id` filter.
 */
export class PushHistoryQueryDto {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page?: number = 1;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    page_size?: number = 25;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    user_id?: number;

    @IsOptional()
    @IsString()
    @MaxLength(100)
    trigger_type?: string;

    @IsOptional()
    @Type(() => Boolean)
    @IsBoolean()
    success?: boolean;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    date_from?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    date_to?: number;

    @IsOptional()
    @IsIn(['sent_at'])
    sort?: 'sent_at' = 'sent_at';

    @IsOptional()
    @IsIn(['asc', 'desc'])
    order?: 'asc' | 'desc' = 'desc';
}
