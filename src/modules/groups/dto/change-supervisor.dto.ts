import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

/**
 * D-12: PATCH /admin-api/v1/admin/groups/:id/supervisor — single-tx supervisor change.
 *
 * supervisor_id contract:
 *   - 0 means "clear assignment" (translated to null at the service layer).
 *     class-validator does not have a clean way to accept literal `null` in a numeric
 *     body field, so 0 is the agreed sentinel. Plan 02/03 service code maps:
 *         supervisor_id === 0 ? null : supervisor_id
 *   - any positive integer is treated as a User.id; service validates the user exists
 *     and (in admin scope) that the actor is permitted to set them as supervisor.
 *
 * reason: optional free-text auditing rationale; surfaced in audit log meta.
 *
 * Audit: @Audit('groups.supervisor.change', 'group') in Plan 03 controller.
 */
export class ChangeSupervisorDto {
    @Type(() => Number)
    @IsInt()
    @Min(0)
    supervisor_id!: number; // 0 means "clear assignment" -> null at service layer

    @IsOptional()
    @IsString()
    reason?: string;
}
