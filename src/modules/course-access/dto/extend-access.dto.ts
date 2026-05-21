import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

/**
 * Phase 18 — PATCH /admin-api/v1/admin/sales/:saleId/access body.
 *
 * Updates `access_days` on an existing active (non-refunded) Sale row,
 * regardless of whether the sale is direct (`buyer_id` set) or group-scoped
 * (`group_id` set).
 *
 *   - `expires_at = null`     → perpetual (access_days = NULL).
 *   - `expires_at = <unix>`   → access_days = ceil((expires_at - sale.created_at) / 86400).
 *   - <= sale.created_at     → 400 `course_access.expires_in_past`.
 *
 * 404 if the sale does not exist.
 * 409 `course_access.already_revoked` if the sale has been refunded.
 *
 * The field is intentionally `null`-able rather than `undefined`-able: the
 * caller must commit to a value (date or perpetual) — there is no "leave
 * as-is" branch.
 */
export class ExtendAccessDto {
    /** Unix seconds. NULL = perpetual. */
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    expires_at!: number | null;
}
