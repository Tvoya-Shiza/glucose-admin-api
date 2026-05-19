import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * GET /admin-api/v1/admin/boards — list boards visible to the actor.
 *
 * Scope: admin sees all (via BOARD_SCOPE_RULES); others see boards where they are
 * a member (creator counts because BoardsService auto-adds the creator as owner).
 */
export class ListBoardsDto {
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
    @IsIn(['active', 'archived', 'all'])
    status?: 'active' | 'archived' | 'all';

    @IsOptional()
    @IsString()
    q?: string;

    @IsOptional()
    @IsIn(['created_at', 'name'])
    sort?: 'created_at' | 'name';

    @IsOptional()
    @IsIn(['asc', 'desc'])
    order?: 'asc' | 'desc';
}
