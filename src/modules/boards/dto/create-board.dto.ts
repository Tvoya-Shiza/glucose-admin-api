import { IsHexColor, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * POST /admin-api/v1/admin/boards — create a board. Gated by `boards.create`.
 *
 * Default columns (`To Do` / `In Progress` / `Done`) are seeded server-side by
 * BoardsService; the client does not send them on the create call. Members
 * are added via a separate PUT /:id/members call so the creator can ship the
 * board first, invite later.
 */
export class CreateBoardDto {
    @IsString()
    @MinLength(1)
    @MaxLength(128)
    name!: string;

    @IsOptional()
    @IsString()
    @MaxLength(8000)
    description?: string;

    @IsOptional()
    @IsHexColor()
    color?: string;
}
