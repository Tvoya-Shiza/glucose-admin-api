import { Transform } from 'class-transformer';
import {
    IsBoolean,
    IsEmail,
    IsInt,
    IsOptional,
    IsString,
    Matches,
    MaxLength,
    Min,
} from 'class-validator';

/**
 * UNIV-02 — create/update DTO. Used by both POST and PATCH (PATCH ignores missing
 * fields via `data: undefined` discard in the service).
 *
 * `unik` is the unique business code; required on create, optional on PATCH (the
 * service rejects rename attempts that collide with another row).
 *
 * Empty strings on optional contact fields are coerced to null so the operator can
 * clear a value without supplying an explicit null.
 */
const toNullable = ({ value }: { value: unknown }) => {
    if (value === '' || value === undefined) return null;
    return value;
};

export class UpsertUniversityDto {
    @IsOptional()
    @IsString()
    @Matches(/^[A-Za-z0-9._-]+$/, { message: 'unik must contain only [A-Za-z0-9._-]' })
    @MaxLength(32)
    unik?: string;

    @IsOptional()
    @Transform(({ value }) => (value === '' || value === null ? null : Number(value)))
    @IsInt()
    @Min(1)
    city_id?: number | null;

    @IsOptional()
    @Transform(toNullable)
    @IsString()
    @MaxLength(255)
    website?: string | null;

    @IsOptional()
    @Transform(toNullable)
    @IsString()
    @MaxLength(64)
    phone?: string | null;

    @IsOptional()
    @Transform(toNullable)
    @IsEmail()
    @MaxLength(160)
    email?: string | null;

    @IsOptional()
    @Transform(toNullable)
    @IsString()
    @MaxLength(120)
    instagram?: string | null;

    @IsOptional()
    @Transform(toNullable)
    @IsString()
    @MaxLength(255)
    address?: string | null;

    @IsOptional()
    @IsBoolean()
    has_dormitory?: boolean;

    @IsOptional()
    @IsBoolean()
    has_military_department?: boolean;

    @IsOptional()
    @IsString()
    @MaxLength(255)
    title_kk?: string;

    @IsOptional()
    @Transform(toNullable)
    @IsString()
    @MaxLength(1024)
    short_desc_kk?: string | null;

    @IsOptional()
    @Transform(toNullable)
    @IsString()
    @MaxLength(65535)
    full_desc_kk?: string | null;

    @IsOptional()
    @Transform(toNullable)
    @IsString()
    @MaxLength(26)
    icon_asset_id?: string | null;

    @IsOptional()
    @Transform(toNullable)
    @IsString()
    @MaxLength(26)
    image_asset_id?: string | null;
}
