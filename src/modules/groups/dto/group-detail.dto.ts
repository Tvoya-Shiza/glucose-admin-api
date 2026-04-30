import type { SupervisorRefDto } from './group-row.dto';

/**
 * GRP-02: group-detail response shapes — overview, member rows, member-progress rows.
 *
 * Member-progress (D-07) signals available in this schema:
 *   - "Course access granted" = Sale row WHERE webinar_id IS NOT NULL AND refund_at IS NULL
 *     (Phase 3 Plan 05 pattern).
 *   - "Course completed" = RewardAccounting row WHERE type='learning_progress_100' AND
 *     user_id=X AND item_id=webinar_id (the only learning-progress sentinel in this
 *     schema).
 *
 * NOTE: WebinarUser.completed_at does NOT exist in this schema — CONTEXT D-07 referenced
 * it in error. Plan 04 must use the signals above.
 */
export class GroupDetailDto {
    id!: number;
    name!: string;
    status!: 'active' | 'inactive';
    supervisor!: SupervisorRefDto | null;
    creator!: { id: number; full_name: string | null } | null;
    member_count!: number;
}

export class MemberRowDto {
    user_id!: number;
    full_name!: string | null;
    email!: string | null;
    role_name!: string;
    status!: 'active' | 'inactive' | 'pending';
    joined_at!: number; // GroupUser.created_at (Unix seconds)
    last_activity!: number | null; // User.last_activity (Unix seconds)
}

export class MemberListResponseDto {
    rows!: MemberRowDto[];
    total!: number;
    page!: number;
    page_size!: number;
}

export class MemberProgressRowDto {
    user_id!: number;
    courses_started!: number; // distinct webinar_id from Sale where refund_at IS NULL
    courses_completed!: number; // distinct item_id from RewardAccounting type=learning_progress_100
}

export class MemberProgressResponseDto {
    rows!: MemberProgressRowDto[];
}
