import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * Phase 8 Plan 05 — mailings history list query DTO (PSH-06).
 *
 * Mirrors PushHistoryQueryDto shape; categories differ (mailing vs push).
 *
 * Filters (D-16):
 *   - user_id     (numeric narrowing on MailingLog.user_id)
 *   - subject     (substring contains)
 *   - success     (boolean)
 *   - category    (marketing | transactional | reminder | system)
 *   - date_from / date_to  (Unix seconds, MailingLog.sent_at)
 *
 * Pagination defaults: page=1, page_size=25 (cap 100).
 *
 * RBAC scoping is applied SERVER-SIDE in MailingsHistoryService — admin-only
 * (D-19). Curator/teacher receive 403.
 */
export class MailingsHistoryQueryDto {
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
    @MaxLength(255)
    subject?: string;

    @IsOptional()
    @Type(() => Boolean)
    @IsBoolean()
    success?: boolean;

    @IsOptional()
    @IsIn(['marketing', 'transactional', 'reminder', 'system'])
    category?: string;

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
