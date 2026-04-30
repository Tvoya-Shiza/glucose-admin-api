import { Type } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * USR-03 (profile half) — PATCH /:id/profile DTO.
 *
 * Every field optional so the client can edit-in-place per field (D-09). The global
 * ValidationPipe is configured `whitelist: true, forbidNonWhitelisted: true, transform: true`
 * so unknown fields are rejected (T-03-23). Mobile is normalized server-side via
 * `normalizeKzPhone` before write — the client may send `+7XXXXXXXXXX | 8XXXXXXXXXX | (+7)...`.
 *
 * Role changes are NOT in this DTO — role_id / role_name live in Plan 04's RoleChangeDialog
 * because role mutation has cascade audit + access consequences (D-11).
 */
export class PatchUserProfileDto {
    @IsOptional()
    @IsString()
    @MinLength(1)
    @MaxLength(255)
    full_name?: string;

    @IsOptional()
    @IsEmail()
    @MaxLength(255)
    email?: string;

    @IsOptional()
    @IsString()
    @MaxLength(32)
    mobile?: string;

    @IsOptional()
    @IsIn(['active', 'inactive', 'pending'])
    status?: 'active' | 'inactive' | 'pending';

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    country_id?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    province_id?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    city_id?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    school_id?: number;

    @IsOptional()
    @IsString()
    @MaxLength(255)
    avatar?: string;

    @IsOptional()
    @IsString()
    about?: string;

    @IsOptional()
    @IsBoolean()
    verified?: boolean;
}
