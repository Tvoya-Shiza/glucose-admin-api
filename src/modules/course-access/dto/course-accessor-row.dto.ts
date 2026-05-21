/**
 * Phase 19 / Feature C — response shapes for the per-course accessors list
 * and its summary KPI cards.
 *
 * Mirrors glucose-admin-client/src/lib/course-access/types.ts. Keep in lockstep.
 */

export class AccessorUserRefDto {
    id!: number;
    full_name!: string | null;
    email!: string | null;
    mobile!: string | null;
}

export class AccessorSourceRefDto {
    /** 'direct' = user-bought; 'group' = via group membership. */
    kind!: 'direct' | 'group';
    /** Populated when kind='group'; otherwise null. Used to render "Group: <name>". */
    group_id!: number | null;
    group_name!: string | null;
}

export class CourseAccessorRowDto {
    user!: AccessorUserRefDto;
    source!: AccessorSourceRefDto;
    /** Sale.id backing this row — used as handle for PATCH / DELETE /sales/:saleId/access.
     *  For 'group' rows this is the group's grant sale (shared across all members). */
    sale_id!: number;
    /** Unix seconds. */
    granted_at!: number;
    /** Unix seconds; null = perpetual. */
    expires_at!: number | null;
    /** Whole days from now to expires_at; 0 when expired; null when perpetual. */
    days_remaining!: number | null;
    /** MAX(created_at) across course_learning / quiz_results / webinar_assignment_history
     *  for this user × this course. null when the user has never interacted. */
    last_course_activity!: number | null;
    /** TRUE when refund_at IS NULL AND access is not expired. */
    is_active!: boolean;
}

export class CourseAccessorsListResponseDto {
    rows!: CourseAccessorRowDto[];
    total!: number;
    page!: number;
    page_size!: number;
}

export class CourseAccessorsSummaryDto {
    /** Unique users with access (direct + via group, deduped). */
    total!: number;
    /** Users with direct (purchased / admin-granted) access. */
    direct_count!: number;
    /** Users whose ONLY source is via-group (excluded from direct_count). */
    via_group_count!: number;
    /** Number of distinct active group grants on this course. */
    groups_count!: number;
    /** Users whose last_course_activity falls in the last 7 days. */
    active_last_7d!: number;
}
