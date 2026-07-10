import type {
    CreditBankStatus,
    CreditDifficulty,
    CreditFinishReason,
    CreditLaunchStatus,
    CreditPassType,
    CreditQuestionMark,
    CreditSessionStatus,
    CreditStatus,
} from '@shared/credits';

/**
 * Internal response shapes for the admin credits surface (contract §admin API).
 *
 * Credit-domain ids stay `bigint` inside the services and are serialized to
 * STRINGS by the global BigIntStringInterceptor — never Number() them.
 * users / webinars / chapters / chapter-items ids are plain numbers.
 */

export interface CreditTopicNode {
    id: bigint;
    parent_id: bigint | null;
    name: string;
    position: number;
    status: CreditBankStatus;
    question_count: number;
    child_count: number;
    /** Phase 36 — set when the topic mirrors a course lesson (else both null). */
    course_id: number | null;
    chapter_item_id: number | null;
}

export interface CreditQuestionRow {
    id: bigint;
    topic: { id: bigint; name: string; course_id: number | null; chapter_item_id: number | null };
    difficulty: CreditDifficulty;
    question: string;
    answer: string;
    score: number;
    status: CreditBankStatus;
    created_at: number;
    updated_at: number | null;
}

export interface CreditStats {
    students: number;
    passed: number;
    failed: number;
    pending: number;
}

export interface CreditLessonRef {
    chapter_item_id: number;
    title: string | null;
}

export interface CreditRow {
    id: bigint;
    title: string;
    course: { id: number; title: string | null };
    chapter: { id: number; title: string | null };
    group: { id: number; name: string };
    scheduled_at: number | null;
    status: CreditStatus;
    lessons: CreditLessonRef[];
    stats: CreditStats;
    last_launch_at: number | null;
    created_at: number;
}

export interface CreditCalendarEntry {
    id: bigint;
    title: string;
    scheduled_at: number;
    group: { id: number; name: string };
    course: { id: number; title: string | null };
    status: CreditStatus;
}

export interface CreditHistoryRow {
    session_id: bigint;
    launch_id: bigint;
    student: { id: number; full_name: string | null };
    attempt_number: number;
    started_at: number | null;
    finished_at: number | null;
    score: number | null;
    max_score: number;
    percent: number | null;
    status: CreditSessionStatus;
    passed: boolean | null;
    retake_at: number | null;
}

export interface EligibleStudent {
    id: number;
    full_name: string | null;
    email: string | null;
    passed: boolean;
    attempts_used: number;
    active_session_id: bigint | null;
}

export interface CreditSessionSummary {
    id: bigint;
    student: { id: number; full_name: string | null };
    status: CreditSessionStatus;
    attempt_number: number;
    correct_count: number;
    incorrect_count: number;
    answered_count: number;
    question_count: number;
    score_so_far: number;
    max_score: number;
    passed: boolean | null;
    ends_at: number | null;
    remaining_sec: number | null;
}

export interface CreditLaunchDetail {
    id: bigint;
    credit_id: bigint;
    curator: { id: number; full_name: string | null };
    status: CreditLaunchStatus;
    topic_ids: string[];
    question_count: number;
    difficulty_template: CreditDifficulty[];
    duration_sec: number;
    pass_type: CreditPassType;
    pass_value: number;
    created_at: number;
    sessions: CreditSessionSummary[];
}

export interface CreditSessionQuestionView {
    position: number;
    difficulty: CreditDifficulty;
    score: number;
    question: string;
    answer: string;
    mark: CreditQuestionMark;
    marked_at: number | null;
}

export interface CreditSessionResultView {
    score: number;
    max_score: number;
    percent: number;
    passed: boolean;
    pass_threshold: number;
    finish_reason: CreditFinishReason;
}

/** FULL curator view of one session (contract §conduct GET; every mutation returns the same shape). */
export interface CreditSessionDetail {
    id: bigint;
    launch_id: bigint;
    credit_id: bigint;
    student: { id: number; full_name: string | null };
    status: CreditSessionStatus;
    attempt_number: number;
    current_position: number | null;
    duration_sec: number;
    started_at: number | null;
    ends_at: number | null;
    server_now: number;
    remaining_sec: number | null;
    questions: CreditSessionQuestionView[];
    result: CreditSessionResultView | null;
    retake_at: number | null;
}
