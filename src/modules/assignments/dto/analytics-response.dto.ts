export interface AssignmentSparklinePoint {
    /** Bucket start (unix seconds, UTC, day-aligned). */
    bucket: number;
    submissions: number;
}

export interface AssignmentAnalyticsDto {
    /** Counts by lifecycle status. */
    active_count: number;
    inactive_count: number;
    /** Total submissions (WebinarAssignmentHistory rows) across the visible scope. */
    submissions_total: number;
    /** Submissions in the last 30 days. */
    submissions_30d: number;
    /** History rows where status === 'pending' and no curator message exists yet. */
    pending_review_count: number;
    /** passed / (passed + not_passed) — null when the denominator is zero. */
    completion_rate: number | null;
    /** Average grade over passed submissions. Null when no passes recorded. */
    avg_grade: number | null;
    /** History rows where deadline elapsed and status === 'not_submitted'. */
    deadline_missed_count: number;
    /** Median hours between WebinarAssignmentHistory.created_at and first curator reply with grade != null. */
    time_to_grade_median_hours: number | null;
    /** 30-day daily submission counts, oldest first. */
    sparkline: AssignmentSparklinePoint[];
}
