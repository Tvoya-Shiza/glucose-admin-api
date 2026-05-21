import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

/**
 * Phase 18 — POST /admin-api/v1/admin/users/:userId/course-access body.
 *
 * Creates a direct (per-user) Sale row with `buyer_id=<userId>`, `group_id=NULL`,
 * `manual_added=true`, `payment_method=null` (no Kaspi transaction), `amount=0`.
 *
 * `expires_at` is OPTIONAL:
 *   - omitted / null  → perpetual access (`access_days = NULL`).
 *   - Unix sec value  → backend computes `access_days = ceil((expires_at - created_at) / 86400)`.
 *   - in the past     → 400 `course_access.expires_in_past`.
 *
 * Conflicts: returns 409 `course_access.already_granted_to_user` if an active
 * (non-refunded) direct grant for (user, course) already exists. Use the
 * PATCH /sales/:saleId/access endpoint to extend an existing grant instead.
 */
export class GrantUserAccessDto {
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
