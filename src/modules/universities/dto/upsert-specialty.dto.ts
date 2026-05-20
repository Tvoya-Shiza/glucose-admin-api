import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/**
 * Used by both POST and PATCH on `/admin-api/v1/admin/specialties`.
 * `code` is the unique business identifier (e.g. "B009").
 */
export class UpsertSpecialtyDto {
    @IsOptional()
    @IsString()
    @Matches(/^[A-Za-z0-9._-]+$/, { message: 'code must contain only [A-Za-z0-9._-]' })
    @MaxLength(32)
    code?: string;

    @IsOptional()
    @IsString()
    @MaxLength(255)
    title_kk?: string;
}
