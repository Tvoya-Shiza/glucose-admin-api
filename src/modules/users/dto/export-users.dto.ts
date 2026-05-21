import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString } from 'class-validator';

/**
 * USR-07 — export-users body DTO. Mirrors `ListUsersDto` (Plan 01) for filter shape so
 * URL state from the list page round-trips into the export call exactly. `format` is
 * the only required field; everything else is optional and matches the list contract.
 *
 * `page` / `page_size` / `cursor` are intentionally omitted — exports respect the
 * scope + filter set, but never paginate (50k server-side cap enforced in service).
 */
export class ExportUsersDto {
    @IsIn(['csv', 'xlsx'])
    format!: 'csv' | 'xlsx';

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
}

/**
 * Body DTO for POST /admin-api/v1/admin/users/:id/export — single-user audit-friendly
 * report combining profile + course access + quiz access + recent payments.
 */
export class ExportUserDetailDto {
    @IsIn(['csv', 'xlsx'])
    format!: 'csv' | 'xlsx';
}
