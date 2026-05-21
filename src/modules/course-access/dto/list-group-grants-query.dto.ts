import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Phase 18 — GET /admin-api/v1/admin/groups/:groupId/course-access query.
 *
 * Pagination only — no search/sort on this surface (a group typically has
 * few grants; if a group exceeds 50, the page=2 path is straightforward).
 *
 * `only_active` defaults to true — most operators want the live grants;
 * passing `?only_active=false` includes refunded ones for audit review.
 */
export class ListGroupGrantsQueryDto {
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
    @Type(() => Boolean)
    @IsBoolean()
    only_active?: boolean;
}
