import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, Min, ValidateIf, ValidateNested } from 'class-validator';

/**
 * PUT /admin-api/v1/admin/boards/:id/tasks/:tid/assignees — bulk-replace assignees.
 *
 * Polymorphic body: each item picks one of four assignee types.
 *   - `user`     → assignee_id = users.id      (required)
 *   - `role`     → assignee_id = roles.id      (required)
 *   - `group`    → assignee_id = groups.id     (required)
 *   - `everyone` → assignee_id MUST be omitted (sentinel: addresses every staff
 *                  user the actor can see; bff-expanded server-side)
 *
 * Validation:
 *   - `assignee_id` is required UNLESS `assignee_type === 'everyone'`.
 *   - Service-layer dedup via UNIQUE(task_id, assignee_type, assignee_id).
 */
export class TaskAssigneeDto {
    @IsIn(['user', 'role', 'group', 'everyone'])
    assignee_type!: 'user' | 'role' | 'group' | 'everyone';

    @ValidateIf((o) => o.assignee_type !== 'everyone')
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    assignee_id?: number;
}

export class SetTaskAssigneesDto {
    @IsArray()
    @ArrayMaxSize(100)
    @ValidateNested({ each: true })
    @Type(() => TaskAssigneeDto)
    assignees!: TaskAssigneeDto[];
}
