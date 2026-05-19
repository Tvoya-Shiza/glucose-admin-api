import { Type } from 'class-transformer';
import { IsBoolean, IsHexColor, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

/**
 * PATCH /admin-api/v1/admin/boards/:id/columns/:cid — partial column update.
 * `position` is NOT accepted here — use the dedicated reorder endpoint so the
 * server can update all sibling positions atomically.
 */
export class UpdateColumnDto {
    @IsOptional()
    @IsString()
    @MinLength(1)
    @MaxLength(64)
    name?: string;

    @IsOptional()
    @IsHexColor()
    color?: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    wip_limit?: number;

    @IsOptional()
    @IsBoolean()
    is_done_column?: boolean;
}
