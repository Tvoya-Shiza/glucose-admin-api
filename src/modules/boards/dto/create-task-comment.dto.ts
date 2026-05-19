import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * POST /admin-api/v1/admin/boards/:id/tasks/:tid/comments
 * Flat comments (no threading). Plain text — markdown rendered on the client.
 */
export class CreateTaskCommentDto {
    @IsString()
    @MinLength(1)
    @MaxLength(8000)
    content!: string;
}
