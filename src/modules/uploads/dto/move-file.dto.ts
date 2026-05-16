import { IsInt, IsOptional, Min } from 'class-validator';

/**
 * Body for `PATCH /admin-api/v1/admin/uploads/:id/move`.
 * `folder_id` null or omitted → move to root.
 */
export class MoveFileDto {
    @IsOptional()
    @IsInt()
    @Min(1)
    folder_id?: number | null;
}
