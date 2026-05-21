/**
 * Phase 18 — response shapes for the course-access surface.
 *
 * Mirrors glucose-admin-client/src/lib/course-access/types.ts. Keep in lockstep.
 */

export class CourseRefDto {
    id!: number;
    /** KZ title (preferred) or slug fallback. */
    title!: string;
    slug!: string;
}

export class GrantedByRefDto {
    id!: number;
    full_name!: string | null;
}

/**
 * One row in the "courses granted to this group" list.
 *
 * `expires_at` is computed server-side from `sale.created_at + access_days * 86400`.
 * NULL when `access_days` is NULL (perpetual access).
 *
 * `days_remaining` is also server-computed (rounded down to whole days from
 * `now`). NULL for perpetual; negative values are clamped to 0.
 *
 * `is_active` mirrors `refund_at IS NULL` AND `expires_at > now`.
 */
export class CourseGrantRowDto {
    /** Sale.id — used as the handle for PATCH/DELETE /sales/:saleId/access. */
    sale_id!: number;
    course!: CourseRefDto;
    granted_at!: number;
    /** Unix seconds; NULL = perpetual. */
    expires_at!: number | null;
    /** Whole days from now until expires_at. NULL for perpetual, 0 for expired. */
    days_remaining!: number | null;
    /** TRUE when not refunded AND not expired. */
    is_active!: boolean;
    /** NULL when the original audit row is missing (legacy sales). */
    granted_by!: GrantedByRefDto | null;
    refund_at!: number | null;
}

export class GroupGrantsListResponseDto {
    rows!: CourseGrantRowDto[];
    total!: number;
    page!: number;
    page_size!: number;
}

/** Returned by POST /users/:userId/course-access and POST /groups/:groupId/course-access. */
export class CreatedGrantDto {
    sale_id!: number;
    target_type!: 'user' | 'group';
    target_id!: number;
    webinar_id!: number;
    access_days!: number | null;
    expires_at!: number | null;
    created_at!: number;
}

/** Returned by PATCH /sales/:saleId/access. */
export class ExtendedGrantDto {
    sale_id!: number;
    access_days!: number | null;
    expires_at!: number | null;
    previous_access_days!: number | null;
}

/** Returned by DELETE /sales/:saleId/access. */
export class RevokedGrantDto {
    sale_id!: number;
    refund_at!: number;
}
