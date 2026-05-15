import type { CourseStatusFilter, TranslationCompleteness } from './list-courses.dto';

/**
 * CRS-01 / CRS-02 list-row response DTO.
 *
 * Phase 5 Plan 01 locked contract surface — Plans 02/03 consume EXACTLY these field names.
 * NOT a class-validator class — list responses are plain shape contracts (mirror Phase 4
 * group-row.dto.ts pattern).
 *
 * Schema-truth notes:
 *   - id is Webinar.id (Int) — number on the wire (NOT BigInt).
 *   - status comes from WebinarStatus enum (active|pending|is_draft|inactive).
 *   - teacher resolved from Webinar.teacher relation (schema line 826).
 *   - category resolved from Webinar.category relation (schema line 827); slug carried for list display.
 *   - image_cover is NOT NULL on schema (line 814) — empty string when not yet uploaded.
 *   - translation_completeness computed server-side per CONTEXT D-03:
 *       'complete' iff WebinarTranslations row for kz exists with non-empty title.
 *   - missing_locales lists which of {kz} lack a translation row OR have empty title.
 *   - created_at is Unix seconds (schema line 815).
 *   - updated_at is Unix seconds, nullable (schema line 816).
 */
export interface TeacherRef {
    id: number;
    full_name: string | null;
}

export interface CategoryRef {
    id: number;
    slug: string;
}

export interface CourseRowDto {
    id: number;
    slug: string;
    /** KZ title from WebinarTranslations join (locale='kz'). null when missing. */
    title_kz: string | null;
    status: CourseStatusFilter;
    teacher: TeacherRef | null;
    category: CategoryRef | null;
    image_cover: string;
    translation_completeness: TranslationCompleteness;
    missing_locales: 'kz'[];
    /**
     * Count of WebinarChapter rows whose `webinar_id === this.id`. Computed via
     * Prisma `_count` aggregate in the same findMany — NOT an N+1 fetch.
     * Surfaced for the Plan 02 DeleteCourseDialog cascade copy + TypeTheCountConfirmation gate.
     */
    chapter_count: number;
    created_at: number;
    updated_at: number | null;
}

export interface CourseListResponseDto {
    rows: CourseRowDto[];
    total: number;
    page: number;
    page_size: number;
}
