import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * Phase 19 / Feature C — GET /admin-api/v1/admin/courses/:courseId/accessors query.
 *
 * The endpoint UNIONs:
 *   • direct accessors (sales.buyer_id IS NOT NULL, webinar_id = courseId, refund_at IS NULL)
 *   • group-grant accessors (sales.group_id IN groups with access, expanded to members)
 *
 * Filters operate on the merged result set (after dedup; direct beats group on tie).
 * Pagination + sort happens in JS — admin-data scale (expected N < 5000 per course).
 */
export class ListCourseAccessorsQueryDto {
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

    /** Free-text search across user.full_name / user.email / user.mobile (mobile normalized). */
    @IsOptional()
    @IsString()
    q?: string;

    /** Filter to a specific group's members only. Includes only group-source rows. */
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    group_id?: number;

    /** 'direct' = only buyers; 'group' = only via-group; omitted = both. */
    @IsOptional()
    @IsIn(['direct', 'group'])
    source?: 'direct' | 'group';

    /** Sort field. 'last_activity' is recent-first; 'granted_at' is the sale's created_at. */
    @IsOptional()
    @IsIn(['granted_at', 'expires_at', 'last_activity', 'full_name'])
    sort?: 'granted_at' | 'expires_at' | 'last_activity' | 'full_name';

    @IsOptional()
    @IsIn(['asc', 'desc'])
    order?: 'asc' | 'desc';
}
