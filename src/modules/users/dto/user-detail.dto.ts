/**
 * USR-02 / USR-03 / USR-08 — response shapes for the user detail page.
 *
 * Locked field shape (Phase 3 Plan 03 frontmatter <interfaces>). Plans 04+ that
 * extend the detail page (role-change, bulk operations) consume these EXACTLY.
 *
 * BigInt: User.id is `Int` in this Prisma schema, so plain `number` is safe.
 * AdminAuditLog.id is `BigInt` -> we serialize as Number at the boundary because
 * the audit table id stays well under 2^53 and the BigIntStringInterceptor would
 * still hand the row through as `number` for safe values; here we Number(...) at
 * the service to keep the wire shape consistent with UserRowDto.
 */
export class UserDetailDto {
    // Row fields (mirror UserRowDto shape)
    id!: number;
    full_name!: string | null;
    email!: string | null;
    mobile!: string | null;
    role_id!: number;
    role_name!: string;
    status!: 'active' | 'inactive' | 'pending';
    last_activity!: number | null;
    created_at!: number;
    updated_at!: number | null;

    // Region context
    country_id!: number | null;
    province_id!: number | null;
    city_id!: number | null;
    school_id!: number | null;

    avatar!: string | null;
    about!: string | null;
    verified!: boolean;

    // Aggregates / nested
    groups!: Array<{ id: number; name: string; supervisor_id: number | null }>;
    course_access!: Array<{
        sale_id: number;
        webinar_id: number | null;
        webinar_name: string | null;
        manual_added: boolean;
        access_days: number | null;
        created_at: number;
        refund_at: number | null;
    }>;
    recent_payments!: Array<{
        id: number;
        amount: string;
        total_amount: string | null;
        created_at: number;
        refund_at: number | null;
    }>;
}

export class UserActivityRowDto {
    id!: number;
    ts!: number;
    actor_id!: number | null;
    action!: string;
    entity!: string;
    entity_id!: string | null;
    meta!: unknown;
}

export class UserActivityResponseDto {
    rows!: UserActivityRowDto[];
    total!: number;
    page!: number;
    page_size!: number;
}
