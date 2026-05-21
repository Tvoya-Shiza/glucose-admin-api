import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

/**
 * Phase 18 — POST /admin-api/v1/admin/groups/:groupId/course-access body.
 *
 * Creates a group-scoped Sale row with `group_id=<groupId>`, `buyer_id=NULL`,
 * `manual_added=true`, `payment_method='group_access'`, `amount=0`.
 *
 * Every current and future member of the group automatically gains access via
 * glucose-api's getUserAccessibleWebinarIds helper (PR-4 work) — no fan-out
 * to per-user sales required.
 *
 * `expires_at` semantics identical to GrantUserAccessDto.
 *
 * Conflicts: returns 409 `course_access.already_granted_to_group` if an active
 * grant for (group, course) already exists.
 */
export class GrantGroupAccessDto {
    @Type(() => Number)
    @IsInt()
    @Min(1)
    webinar_id!: number;

    /** Unix seconds. NULL/omitted = perpetual. */
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    expires_at?: number | null;
}
