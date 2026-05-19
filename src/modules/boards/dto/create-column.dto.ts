import { Type } from 'class-transformer';
import { IsBoolean, IsHexColor, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

/**
 * POST /admin-api/v1/admin/boards/:id/columns — append a new column to the board.
 * Position defaults to end-of-list when omitted. Gated by `boards.manage_columns`
 * (or board owner).
 */
export class CreateColumnDto {
    @IsString()
    @MinLength(1)
    @MaxLength(64)
    name!: string;

    @IsOptional()
    @IsHexColor()
    color?: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    position?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    wip_limit?: number;

    @IsOptional()
    @IsBoolean()
    is_done_column?: boolean;
}
