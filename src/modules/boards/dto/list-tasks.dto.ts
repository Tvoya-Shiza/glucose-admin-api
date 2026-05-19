import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

/**
 * GET /admin-api/v1/admin/boards/:id/tasks — filtered, paginated task list.
 *
 * Default behaviour returns the entire active set (no pagination required since a
 * board is bounded). Pagination params kicked in only when the board grows past
 * the default 500-row cap (handled in TasksService).
 */
export class ListTasksDto {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    column_id?: number;

    @IsOptional()
    @IsIn(['low', 'medium', 'high', 'urgent'])
    priority?: 'low' | 'medium' | 'high' | 'urgent';

    @IsOptional()
    @IsIn(['mine', 'created', 'overdue', 'completed', 'all'])
    filter?: 'mine' | 'created' | 'overdue' | 'completed' | 'all';

    @IsOptional()
    @IsString()
    q?: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    due_before?: number;
}
