import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * Phase 39/40 — list-publishers query DTO. All fields optional.
 *
 * Default sort: name asc. Default page size: 50, capped at 200. `q` matches
 * Publisher.name (contains, case-insensitive via MySQL collation).
 */
export class ListPublishersDto {
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
    @MaxLength(100)
    q?: string;
}
