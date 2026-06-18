import type { CourseStatusFilter, TranslationCompleteness } from './list-courses.dto';
import type { Locale } from './translation.dto';

/**
 * CRS-01 / CRS-04 course-detail response DTO.
 *
 * Phase 5 Plan 01 locked contract surface — Plans 03/05/06 consume these shapes.
 *
 * Schema-truth reconciliations (carried into Plan 03 detail service):
 *
 *   - WebinarChapterItem.type enum is { file | quiz | assignment } per schema line 77 —
 *     NOT { text | image | video } as the CONTEXT sketch suggested. UI sub-types
 *     (rich-text vs image vs video) are derived in admin-client from the linked
 *     Files row's `file_type` MIME prefix:
 *         text/html  → "rich text" (FileTranslations.description holds Tiptap HTML per locale)
 *         image/*    → "image"
 *         video/*    → "video"
 *
 *   - There is NO WebinarChapterItemTranslations model. Per-locale rich-text bodies
 *     for items live in FileTranslations.description (LongText) when type=file. The
 *     ChapterItemDto.translations[] surfaces THIS join when type='file'; null/empty
 *     for type='quiz' or 'assignment'.
 *
 *   - WebinarChapterSchedule does NOT have webinar_id / chapter_id columns — it links
 *     via webinar_chapter_item_id only. counts.schedule_count is the aggregated count
 *     of schedules across this course's items (joined Files → chapter → webinar).
 *
 *   - Webinar.thumbnail and Webinar.image_cover are NOT NULL on schema (lines 813-814).
 *     Default to '' on create.
 *
 *   - Webinar.deleted_at exists (schema line 819) — soft-delete supported.
 *
 *   - Translations array always returns 0..2 entries (server returns whatever exists);
 *     translation_completeness + missing_locales are computed server-side mirroring
 *     CourseRowDto's logic.
 */

export interface TranslationRowDto {
    locale: Locale;
    title: string;
    description: string | null;
}

export interface CourseDetailTeacherRef {
    id: number;
    full_name: string | null;
    email: string | null;
}

export interface CourseDetailCategoryRef {
    id: number;
    slug: string;
    title_kz: string | null;
}

export type FileAccessibility = 'free' | 'paid';

export interface ChapterItemFileRef {
    id: number;
    file_type: string;
    storage: string;
    file: string;
    volume: string;
    /** Phase 13 — per-item access gate. */
    accessibility: FileAccessibility;
}

/** Phase 29 — one PDF inside a multi-file PDF block. */
export interface ChapterItemPdfRef {
    id: number;
    file: string;
    volume: string;
    /** KZ FileTranslations.title — the display label; '' when untitled. */
    title: string;
}

/** Phase 30 — optional lecture-notes attachment ("konspekt") on a content item. */
export interface ChapterItemAttachmentRef {
    id: number;
    file: string;
    /** Real uploaded MIME — drives PDF-vs-download on the public app. */
    file_type: string;
    volume: string;
    /** KZ FileTranslations.title — the display label; '' when untitled. */
    title: string;
}

export interface ChapterItemQuizRef {
    id: number;
    slug: string;
}

export interface ChapterItemAssignmentRef {
    id: number;
    /** KZ title from WebinarAssignmentTranslation. Empty string when not translated. */
    title: string;
}

export type ChapterItemType = 'file' | 'quiz' | 'assignment';

export interface ChapterItemDto {
    id: number;
    type: ChapterItemType;
    order: number | null;
    item_id: number;
    /** Phase 16 — `true` means the item counts toward course completion. */
    is_required: boolean;
    /**
     * Phase 20 — per-item content access gate. Applies to ALL types
     * (file / quiz / assignment). For type='file' the underlying Files.accessibility
     * is kept in sync with this value by the upsert path.
     */
    accessibility: FileAccessibility;
    file: ChapterItemFileRef | null;
    quiz: ChapterItemQuizRef | null;
    assignment: ChapterItemAssignmentRef | null;
    /**
     * Phase 29 — non-empty when this file item is a multi-file PDF block. The
     * `file` ref still points at the first PDF (back-compat); `pdfs` is the full
     * ordered list. Empty array for non-PDF items.
     */
    pdfs: ChapterItemPdfRef[];
    /** Phase 30 — optional lecture-notes attachment; null when none. */
    attachment: ChapterItemAttachmentRef | null;
    /** Only present (non-empty) when type='file' — derived from FileTranslations join. */
    translations: TranslationRowDto[];
}

export type ChapterStatus = 'active' | 'inactive';

export interface ChapterDto {
    id: number;
    order: number | null;
    status: ChapterStatus;
    translations: TranslationRowDto[];
    items: ChapterItemDto[];
}

export interface CourseCounts {
    chapter_count: number;
    item_count: number;
    schedule_count: number;
}

export type CourseType = 'webinar' | 'course' | 'text_lesson';

export interface CoursePricing {
    /** Decimal as string for arbitrary precision (Decimal(15,3) on schema). */
    price: string;
    access_days: number;
}

export interface CourseDetailDto {
    id: number;
    slug: string;
    type: CourseType;
    status: CourseStatusFilter;
    teacher: CourseDetailTeacherRef | null;
    category: CourseDetailCategoryRef | null;
    image_cover: string;
    thumbnail: string;
    capacity: number | null;
    certificate: boolean;
    /** Phase 13: paid course flag. When true, `pricing` is non-null. */
    is_paid: boolean;
    /** Phase 16: strict completion check toggle. Independent of `is_paid`. */
    strict_progress: boolean;
    /** Single price record. Array on schema; for v1 only one entry is surfaced. */
    pricing: CoursePricing | null;
    start_date: number | null;
    duration: number | null;
    position: number | null;
    created_at: number;
    updated_at: number | null;
    deleted_at: number | null;
    translations: TranslationRowDto[];
    translation_completeness: TranslationCompleteness;
    missing_locales: Locale[];
    chapters: ChapterDto[];
    counts: CourseCounts;
}
