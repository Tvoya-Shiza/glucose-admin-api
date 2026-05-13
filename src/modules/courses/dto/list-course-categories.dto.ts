import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * Query DTO for `GET /admin-api/v1/admin/courses/categories`.
 *
 * Pagination is intentionally minimal — categories surface is small (current prod has
 * < 200 rows). `page_size` defaults to 50 and is capped at 200; `q` is a substring
 * filter applied to RU translation title (case-insensitive).
 */
export class ListCourseCategoriesDto {
    @IsOptional()
    @IsString()
    @MaxLength(255)
    q?: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(200)
    page_size?: number;
}
