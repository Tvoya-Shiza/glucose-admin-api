import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Length, Min } from 'class-validator';

/**
 * D-09: POST /admin-api/v1/admin/groups — create a new group.
 *
 *   name: 3..64 chars (matches schema VarChar(64) cap).
 *   status: 'active' | 'inactive' — required at create time.
 *   supervisor_id: optional; null/omitted means "unassigned".
 *
 * Audit: @Audit('groups.create', 'group') in Plan 02 controller.
 */
export class CreateGroupDto {
    @IsString()
    @IsNotEmpty()
    @Length(3, 64)
    name!: string;

    @IsIn(['active', 'inactive'])
    status!: 'active' | 'inactive';

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    supervisor_id?: number | null;
}
