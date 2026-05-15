/**
 * QZ-01 list-row response shape + paginated envelope.
 *
 * Phase 6 Plan 01 — locked contract surface.
 *
 * NOT a class-validator DTO: response shapes are documentation-only TS types
 * surfaced from the list service. Mirrors course-row.dto.ts pattern.
 *
 * Schema-truth notes:
 *   - Quizzes.id is `Int` (line 459) → typed as number (NOT BigInt-as-string).
 *   - Quizzes.time is `Int? @default(0)` (line 463) — null|0 = no limit.
 *   - Quizzes.attempt is `Int?` (line 464) — null = unlimited.
 *   - Quizzes.certificate is `Boolean` (line 466) — REQUIRED on schema.
 *   - Quizzes.version is `Int @default(1)` (line 471) — surfaced for the version-bump UI.
 *   - QuizCategory has no `name` column — surface only `title_ru` from translations join.
 *   - QuizBadge[] surface = id + ru title (translations join).
 *   - question_count is `_count.questions` from Prisma (no N+1).
 *   - translation_completeness/missing_locales: derived from QuizTranslation join.
 */

import type { QuizQuestionCountBucket } from './list-quizzes.dto';

export type QuizRowStatus = 'active' | 'inactive';
export type RowTranslationCompleteness = 'complete' | 'incomplete';
export type RowLocale = 'kz';

export interface QuizRowCategoryRef {
    id: number;
    title_kz: string | null;
}

export interface QuizRowBadgeRef {
    id: number;
    title_kz: string | null;
}

export interface QuizRowDto {
    id: number;
    /** KZ title from QuizTranslation join (locale='kz'). null when missing. */
    title_kz: string | null;
    status: QuizRowStatus;
    /** version is the data-integrity guard from Phase 1.08 SCH-02. Surfaced so the
     *  UI can render a "v{n}" pill next to each row. */
    version: number;
    category: QuizRowCategoryRef | null;
    /** Seconds. null = no time limit. */
    time: number | null;
    /** REQUIRED on schema, but surfaces as number here for direct render. */
    pass_mark: number;
    /** null = unlimited attempts. */
    attempt: number | null;
    certificate: boolean;
    /** _count.questions — server-side aggregate. */
    question_count: number;
    translation_completeness: RowTranslationCompleteness;
    missing_locales: RowLocale[];
    /** All badges that include this quiz (M:N via QuizBadgeItem). */
    badges: QuizRowBadgeRef[];
    /** Unix seconds. */
    created_at: number;
    /** Unix seconds. null when never updated. */
    updated_at: number | null;
}

export interface QuizListResponseDto {
    rows: QuizRowDto[];
    total: number;
    page: number;
    page_size: number;
}

// Re-export so consumers needing the bucket union from one place can import here.
export type { QuizQuestionCountBucket };
