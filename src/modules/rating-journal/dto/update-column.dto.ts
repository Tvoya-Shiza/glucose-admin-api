import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * Body for PATCH /admin-api/v1/admin/rating-journal/columns/:id.
 * Rename / change max-score are custom-column only (guarded in-service);
 * hide/show (`is_hidden`) is allowed on any column kind.
 */
export class UpdateColumnDto {
    @IsOptional()
    @IsString()
    @IsNotEmpty()
    @MaxLength(255)
    title?: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    @Max(100000)
    max_score?: number;

    @IsOptional()
    @IsBoolean()
    is_hidden?: boolean;
}
