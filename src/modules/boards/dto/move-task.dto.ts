import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

/**
 * PUT /admin-api/v1/admin/boards/:id/tasks/:tid/move — single source-of-truth for
 * drag-drop. Server validates the target column belongs to the same board, then
 * compacts sibling positions inside a transaction.
 *
 * Body: `{ column_id, position }`. Position is 0-indexed.
 */
export class MoveTaskDto {
    @Type(() => Number)
    @IsInt()
    @Min(1)
    column_id!: number;

    @Type(() => Number)
    @IsInt()
    @Min(0)
    position!: number;
}
