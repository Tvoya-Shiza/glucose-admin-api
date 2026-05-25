/**
 * QZ-02 / QZ-03 quiz-detail response shape (one quiz with full questions+answers tree).
 *
 * Phase 6 Plan 01 — locked contract surface.
 *
 * NOT a class-validator DTO: response shapes are TS interfaces. Plan 04 detail
 * controller produces this shape; Plan 05 mutates questions/answers and returns
 * either a fresh QuizDetailDto or a delta with version.
 *
 * Schema-truth notes:
 *   - QuizQuestionAnswer has NO `order` column (D-09 deviation) — answers are
 *     ordered by id ASC for v1. Reflected in AnswerDto having NO order field.
 *   - QuizQuestion HAS `order` (line 567) — questions ARE persistently ordered.
 *   - QuizQuestionTranslation.description is the Tiptap HTML (Text column);
 *     QuizQuestionTranslation.correct is the descriptive-answer text (only used
 *     when QuizQuestion.type === 'descriptive', ignored otherwise).
 *   - QuizQuestionAnswer.parent_id is the self-FK for IDENTIFICATIVE pairs:
 *       null  → LEFT-side anchor row (or any non-identificative answer)
 *       N     → RIGHT-side match row, points to the LEFT-side answer.id
 *     Pair UI in Plan 05 reconstructs the two columns from this FK.
 */

import type { Locale } from './translation.dto';

export type QuizDetailStatus = 'active' | 'inactive';
export type QuizQuestionType = 'single' | 'multiple' | 'descriptive' | 'identificative';

/** Per-locale title only (Quiz / Category / Badge level). */
export interface QuizTranslationRef {
    locale: Locale;
    title: string;
}

/** Per-locale title + description (Tiptap) + descriptive correct (Question level). */
export interface QuestionTranslationRef {
    locale: Locale;
    title: string;
    /** Tiptap HTML (sanitized server-side in Plan 05). null = no body. */
    description: string | null;
    /** Descriptive-type "correct answer" text. null for non-descriptive types. */
    correct: string | null;
}

/** Per-locale title only (Answer level). */
export interface AnswerTranslationRef {
    locale: Locale;
    title: string;
}

export interface AnswerDto {
    id: number;
    /** Legacy 1:1 pair link (pre-Phase-24 identificative). Always null in new ENT format. */
    parent_id: number | null;
    /**
     * Phase 24 ENT identificative format. For prompt rows: id of the correct
     * option from the shared pool. For option rows + non-identificative: null.
     * Discriminator: `match_target_id != null` → this row is a prompt.
     */
    match_target_id: number | null;
    image: string | null;
    correct: boolean;
    translations: AnswerTranslationRef[];
    created_at: number;
    updated_at: number | null;
}

export interface QuestionDto {
    id: number;
    type: QuizQuestionType;
    grade: number;
    image: string | null;
    video: string | null;
    answer_video_url: string | null;
    /** Persistent question order (Quizzes.QuizQuestion.order). null when never reordered. */
    order: number | null;
    translations: QuestionTranslationRef[];
    answers: AnswerDto[];
    created_at: number;
    updated_at: number | null;
}

export interface QuizCategoryRef {
    id: number;
    parent_id: number | null;
    /** Joined kz title (no `name` column on QuizCategory). */
    title_kz: string | null;
}

export interface QuizSubjectRef {
    id: number;
    /** Joined kz title from QuizSubjectTranslation. */
    title_kz: string | null;
}

export interface QuizBadgeRef {
    id: number;
    title_kz: string | null;
    is_active: boolean;
}

export interface QuizCounts {
    question_count: number;
    /** Aggregate `total_mark` value as stored on Quizzes.total_mark (server-recomputed). */
    total_mark: number;
}

export interface QuizDetailDto {
    id: number;
    status: QuizDetailStatus;
    version: number;
    category: QuizCategoryRef | null;
    subject: QuizSubjectRef | null;
    /** Seconds. null = no time limit. */
    time: number | null;
    pass_mark: number;
    /** null = unlimited attempts. */
    attempt: number | null;
    certificate: boolean;
    display_questions_randomly: boolean;
    expiry_days: number | null;
    /** Phase 22 — controls public-catalog visibility (true = listed at /quizzes). */
    is_listed: boolean;
    /** Phase 22 — paid-quiz flag. When true, price + access_days are required. */
    is_paid: boolean;
    /** Phase 22 — Decimal(15,3) as string. null when free. */
    price: string | null;
    /** Phase 22 — days of access after purchase. null when free. */
    access_days: number | null;
    translations: QuizTranslationRef[];
    /** Quiz-level translation completeness; mirrors row badge. */
    translation_completeness: 'complete' | 'incomplete';
    missing_locales: Locale[];
    questions: QuestionDto[];
    badges: QuizBadgeRef[];
    counts: QuizCounts;
    created_at: number;
    updated_at: number | null;
}
