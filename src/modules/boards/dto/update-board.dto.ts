import { IsHexColor, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * PATCH /admin-api/v1/admin/boards/:id — partial board update. Gated by `boards.edit`
 * (or board owner). All fields optional. `status: 'archived'` hides the board from
 * the default list but does NOT soft-delete it (use DELETE for that).
 */
export class UpdateBoardDto {
    @IsOptional()
    @IsString()
    @MinLength(1)
    @MaxLength(128)
    name?: string;

    @IsOptional()
    @IsString()
    @MaxLength(8000)
    description?: string;

    @IsOptional()
    @IsHexColor()
    color?: string;

    @IsOptional()
    @IsIn(['active', 'archived'])
    status?: 'active' | 'archived';
}
