import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * GRP-01: list-groups query DTO. All fields optional; numeric fields coerced via @Type
 * because they arrive as query strings on the wire. Validated by the global ValidationPipe
 * (`whitelist: true, forbidNonWhitelisted: true, transform: true`).
 *
 * Locked field shape (Phase 4 Plan 01) — Plans 02/03/04 consume EXACTLY these field names.
 *
 * Default sort: created_at desc (mapped to id desc due to schema gap — Group has no
 * created_at column; id is autoincrement monotonic so it's a safe proxy). Default page
 * size: 50. Per CONTEXT D-03.
 */
export type GroupStatusFilter = 'active' | 'inactive';
export type MemberCountBucket = 'zero' | 'small' | 'medium' | 'large';
export type GroupSortField = 'created_at' | 'name' | 'member_count';
export type SortOrder = 'asc' | 'desc';

export class ListGroupsDto {
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
    @IsIn(['active', 'inactive'])
    status?: GroupStatusFilter;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    supervisor_id?: number;

    @IsOptional()
    @IsIn(['zero', 'small', 'medium', 'large'])
    member_count_bucket?: MemberCountBucket;

    @IsOptional()
    @IsString()
    q?: string;

    @IsOptional()
    @IsIn(['created_at', 'name', 'member_count'])
    sort?: GroupSortField;

    @IsOptional()
    @IsIn(['asc', 'desc'])
    order?: SortOrder;

    @IsOptional()
    @IsString()
    cursor?: string;
}
