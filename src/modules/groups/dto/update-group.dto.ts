import { IsIn, IsOptional, IsString, Length } from 'class-validator';

/**
 * D-10: PATCH /admin-api/v1/admin/groups/:id — name + status only.
 *
 * Supervisor changes go through ChangeSupervisorDto (PATCH /:id/supervisor) per D-12 —
 * NOT through this endpoint. This is a deliberate separation so audit actions can be
 * differentiated (`groups.update` vs `groups.supervisor.change`).
 *
 * Audit: @Audit('groups.update', 'group') in Plan 02 controller.
 */
export class UpdateGroupDto {
    @IsOptional()
    @IsString()
    @Length(3, 64)
    name?: string;

    @IsOptional()
    @IsIn(['active', 'inactive'])
    status?: 'active' | 'inactive';
}
