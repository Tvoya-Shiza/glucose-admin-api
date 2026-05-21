/**
 * Phase 19 / Feature B2 — progress-report response shapes.
 *
 * The same wire shape covers both user-target and group-target requests; the
 * server populates either `user_status` (for `target_kind='user'`) or
 * `group_completion` (for `target_kind='group'`) on each item, leaving the
 * other null. The client renders accordingly.
 */

/** Item status for a single user. */
export class ProgressUserStatusDto {
    /**
     * - 'not_started' — no row in CourseLearning / QuizResult / AssignmentHistory
     * - 'viewed'      — file item: CourseLearning row exists
     * - 'passed'      — quiz/assignment: latest attempt is `passed`
     * - 'failed'      — quiz: failed; assignment: `not_passed`
     * - 'pending'     — assignment submitted, awaiting grading
     * - 'not_submitted' — assignment never opened/submitted (default)
     */
    status!:
        | 'not_started'
        | 'viewed'
        | 'passed'
        | 'failed'
        | 'pending'
        | 'not_submitted';
    /** Best quiz score (user_grade). NULL for non-quiz items or no attempts. */
    score!: number | null;
    /** Assignment grade. NULL for non-assignment items or ungraded. */
    grade!: number | null;
    /** Unix sec of latest interaction with this item. */
    last_at!: number | null;
    /** Number of attempts (quiz attempts; assignment submissions). NULL when N/A. */
    attempts!: number | null;
}

/** Item completion ratio for a group target. */
export class ProgressGroupCompletionDto {
    /** Distinct members of the group who completed this item. */
    done!: number;
    /** Total group members at query time. */
    total!: number;
    /** done / total, rounded to 2 decimals. NaN guard: 0 when total=0. */
    ratio!: number;
}

export class ProgressItemDto {
    /** WebinarChapterItem.id. */
    id!: number;
    type!: string;
    item_id!: number;
    title!: string;
    is_required!: boolean;
    /** Populated when target_kind='user'; null otherwise. */
    user_status!: ProgressUserStatusDto | null;
    /** Populated when target_kind='group'; null otherwise. */
    group_completion!: ProgressGroupCompletionDto | null;
}

export class ProgressChapterDto {
    id!: number;
    title!: string;
    items!: ProgressItemDto[];
}

export class ProgressAggregateDto {
    /** Number of REQUIRED items the target has completed.
     *  - 'user'  → count items where user_status.status is in (viewed | passed) AND is_required.
     *  - 'group' → SUM over required items of (members who completed it); divided by total below for %.
     */
    done!: number;
    /** Total REQUIRED items (* group members, for 'group'). 0 when course has no required items. */
    total!: number;
    /** done / total, 0–1 rounded to 2 decimals. 0 when total=0. */
    percent!: number;
}

export class ProgressTargetSummaryDto {
    kind!: 'user' | 'group';
    target_id!: number;
    /** Display label — user.full_name OR group.name. NULL when target is missing. */
    label!: string | null;
    /** For 'group': member count at query time. NULL for 'user'. */
    members_count!: number | null;
}

export class ProgressReportDto {
    target!: ProgressTargetSummaryDto;
    chapters!: ProgressChapterDto[];
    aggregate!: ProgressAggregateDto;
    /** MAX(created_at) across CourseLearning / QuizResult / AssignmentHistory for
     *  the target × course. For 'group' this is the most-recent activity by ANY
     *  member. NULL when target has never interacted. */
    last_activity!: number | null;
}
