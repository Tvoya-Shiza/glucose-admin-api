import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';

/**
 * PATCH /admin-api/v1/admin/boards/:id/tasks/:tid — partial task update.
 *
 * `column_id` / `position` are intentionally NOT here — use the dedicated /move
 * endpoint so the server can update sibling positions inside a single tx and
 * emit a `column_changed` activity event when the column actually changes.
 *
 * `due_at: null` is allowed (clears the deadline). `IsOptional` + `ValidateIf`
 * combo lets the client send `{ due_at: null }` without tripping IsInt.
 *
 * `completed: true` sets `completed_at = now()` and emits a `completed` activity
 * event. `completed: false` clears it (`reopened`). Independent of column —
 * lets the user mark a task done without dragging into the "Done" column.
 */
export class UpdateTaskDto {
    @IsOptional()
    @IsString()
    @MinLength(1)
    @MaxLength(255)
    title?: string;

    @IsOptional()
    @IsString()
    @MaxLength(16000)
    description?: string | null;

    @IsOptional()
    @IsIn(['low', 'medium', 'high', 'urgent'])
    priority?: 'low' | 'medium' | 'high' | 'urgent';

    @ValidateIf((_, v) => v !== null)
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    due_at?: number | null;

    @IsOptional()
    @IsBoolean()
    completed?: boolean;
}
