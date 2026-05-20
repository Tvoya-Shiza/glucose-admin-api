import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * UNIV-01 — list universities query DTO.
 *
 * All fields optional. Numeric/boolean fields are coerced via @Type because query strings
 * arrive as strings on the wire (and the global ValidationPipe has transform: true).
 *
 * Filters:
 *   - q                       — substring match against `unik`, `title_kk`, `address`
 *   - city_id                 — exact match against Region.id (type=city)
 *   - has_dormitory           — Y/N filter
 *   - has_military_department — Y/N filter
 *
 * Default sort: title_kk asc (alphabetical — admins scan by name).
 */
export class ListUniversitiesDto {
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
    @MaxLength(200)
    q?: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    city_id?: number;

    @IsOptional()
    @Type(() => Boolean)
    @IsBoolean()
    has_dormitory?: boolean;

    @IsOptional()
    @Type(() => Boolean)
    @IsBoolean()
    has_military_department?: boolean;

    @IsOptional()
    @IsIn(['title_kk', 'unik', 'created_at', 'updated_at'])
    sort?: 'title_kk' | 'unik' | 'created_at' | 'updated_at';

    @IsOptional()
    @IsIn(['asc', 'desc'])
    order?: 'asc' | 'desc';
}
