import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    IsArray,
    IsIn,
    IsInt,
    IsOptional,
    IsString,
    MaxLength,
    Min,
    MinLength,
    ValidateNested,
} from 'class-validator';
import { TaskAssigneeDto } from './set-task-assignees.dto';

/**
 * POST /admin-api/v1/admin/boards/:id/tasks — create a task on a board.
 *
 * If `column_id` is omitted the server places the task in the first non-deleted
 * column. Position defaults to "end of column". Assignees are optional on create
 * — author can populate them later via PUT /tasks/:id/assignees.
 */
export class CreateTaskDto {
    @IsString()
    @MinLength(1)
    @MaxLength(255)
    title!: string;

    @IsOptional()
    @IsString()
    @MaxLength(16000)
    description?: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    column_id?: number;

    @IsOptional()
    @IsIn(['low', 'medium', 'high', 'urgent'])
    priority?: 'low' | 'medium' | 'high' | 'urgent';

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    due_at?: number;

    @IsOptional()
    @IsArray()
    @ArrayMaxSize(100)
    @ValidateNested({ each: true })
    @Type(() => TaskAssigneeDto)
    assignees?: TaskAssigneeDto[];
}
