import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    ArrayMinSize,
    ArrayUnique,
    IsArray,
    IsIn,
    IsInt,
    IsOptional,
    IsString,
    Max,
    Min,
} from 'class-validator';

/**
 * D-06 / D-07 / D-20 — query DTOs for the members-tab endpoints (Plan 04).
 *
 * `ListMembersDto` decodes query-string params for GET /:id/members.
 *   - page / page_size : standard offset pagination (page_size capped at 200)
 *   - q                : substring search against User.full_name (MySQL collation
 *     handles case-insensitivity natively; Prisma `mode: 'insensitive'` is Postgres-only)
 *   - window           : activity-window selector (1d / 7d / 30d / all). The endpoint
 *     ALWAYS returns the full page payload — admin-client filters client-side per
 *     CONTEXT D-20. This field is reserved here for forward compatibility (future
 *     server-side narrowing of the `last_activity` column).
 *
 * `MemberProgressRequestDto` decodes the body of POST /:id/members/progress.
 * The endpoint is a "read masquerading as POST" (body is a list of user_ids; URL
 * length would otherwise cap us). Cap at 500 user_ids per request — the admin-client
 * chunks if a single page renders more rows (it won't, page_size <= 200).
 */

export type ActivityWindow = '1d' | '7d' | '30d' | 'all';

export class ListMembersDto {
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
    q?: string;

    @IsOptional()
    @IsIn(['1d', '7d', '30d', 'all'])
    window?: ActivityWindow;
}

export class MemberProgressRequestDto {
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(500)
    @ArrayUnique()
    @Type(() => Number)
    @IsInt({ each: true })
    @Min(1, { each: true })
    user_ids!: number[];
}
