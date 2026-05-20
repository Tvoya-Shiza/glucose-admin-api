import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

const toNullable = ({ value }: { value: unknown }) => (value === '' || value === undefined ? null : value);

/**
 * UNIV-S link DTO. Used by the nested endpoint
 *   POST/PATCH /admin-api/v1/admin/universities/:uid/specialties[/:sid]
 *
 * `specialty_id` is the FK to the global Specialty directory; the operator picks an
 * existing specialty (or creates one via /admin-api/v1/admin/specialties first).
 */
export class UpsertUniversitySpecialtyDto {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    specialty_id?: number;

    @IsOptional()
    @IsBoolean()
    has_rural_quota?: boolean;

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
}
