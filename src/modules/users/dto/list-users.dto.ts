import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * USR-01: list-users query DTO. All fields optional; numeric fields coerced via @Type
 * because they arrive as query strings on the wire. Validated by the global ValidationPipe
 * (`whitelist: true, forbidNonWhitelisted: true, transform: true`).
 *
 * Locked field shape (Phase 3 Plan 01) — Plans 02-07 consume EXACTLY these field names.
 */
export class ListUsersDto {
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
    role_name?: string;

    @IsOptional()
    @IsIn(['active', 'inactive', 'pending'])
    status?: 'active' | 'inactive' | 'pending';

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    region_id?: number;

    @IsOptional()
    @IsString()
    q?: string;

    @IsOptional()
    @IsIn(['created_at', 'full_name', 'last_activity'])
    sort?: 'created_at' | 'full_name' | 'last_activity';

    @IsOptional()
    @IsIn(['asc', 'desc'])
    order?: 'asc' | 'desc';

    @IsOptional()
    @IsString()
    cursor?: string;
}
