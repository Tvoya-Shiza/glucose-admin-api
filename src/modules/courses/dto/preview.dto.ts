import { IsInt, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';
import type { Locale } from './translation.dto';
import type { ChapterItemType, ChapterStatus, CourseType } from './course-detail.dto';
import type { CourseStatusFilter } from './list-courses.dto';

/**
 * CRS-09 — preview-as-student query + response DTOs (Plan 07).
 *
 * Surface design notes:
 *
 *   - Read-only mirror, NOT impersonation. The admin's session stays admin; this
 *     endpoint just returns the course tree the way the student app's content endpoint
 *     would, with optional schedule-filtering for one group context. NO Set-Cookie, NO
 *     fake JWT, NO student session swap.
 *
 *   - Optional ?group_id query parameter. Numeric. When present, items have
 *     `visible_now` derived from a per-group WebinarChapterSchedule lookup. When absent,
 *     all items are visible_now=true (admin's "see-everything" mode — no group context).
 *
 *   - Visibility algorithm (mirrors student-app semantics; cross-reference glucose-api
 *     for canonical logic):
 *
 *         For each item, find a WebinarChapterSchedule row with
 *           (group_id = req.group_id, webinar_chapter_item_id = item.id).
 *         If found and `now >= start_date && now <= end_date`, item is visible_now=true.
 *         If found but outside window, item is visible_now=false (with start_date /
 *           end_date echoed so the UI can show "available in N days" / "expired N days
 *           ago" banners).
 *         If NOT found (no schedule for this group), item is visible_now=false.
 *
 *     Rationale for "no schedule = not visible": when a group context is selected,
 *     "no schedule for this group" is the operational state of "not yet scheduled for
 *     this group" — distinct from "scheduled but expired" or "scheduled, future".
 *     Without group_id (admin see-everything), all items are visible_now=true.
 *     Surfaced to the UI so PreviewRenderer can render the right placeholder copy.
 *
 *   - is_before_start / expiration_check are ECHOED on visible_now=false rows so the UI
 *     can match student-app behavior: when expiration_check=false, an item past end_date
 *     can still be displayed (just no longer in the "active" window). The PreviewRenderer
 *     in admin-client uses `visible_now` as the gate — these flags are informational.
 *
 *   - File items: when type='file', the response includes the joined Files row's
 *     metadata (file URL, file_type MIME, volume) plus FileTranslations for both locales
 *     when present. The admin-client's PreviewRenderer derives the rendering style
 *     (image / video / rich-text HTML) from `file_type` MIME prefix, mirroring the
 *     ChapterItem mapping pattern in courses-detail.service.
 *
 *   - quiz / assignment items: minimal ref echoed (item_id only). Phase 6 (quizzes)
 *     and a future phase (assignments) will surface fuller metadata; for Plan 07 the
 *     PreviewRenderer shows a "Phase 6 placeholder" copy block.
 */

export class PreviewQueryDto {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    group_id?: number;
}

// Response shape — TypeScript interfaces for the controller's return type.

export interface PreviewTranslationRow {
    locale: Locale;
    title: string;
    description: string | null;
}

export interface PreviewFileTranslation {
    locale: Locale;
    title: string;
    description: string | null;
}

export interface PreviewFileRef {
    id: number;
    file: string; // file URL / disk path on schema (file_storage.upload-served via nginx /static/courses/)
    file_type: string;
    /** Files.storage enum value — UI needs this to choose between <video> and <iframe>
     *  for YouTube / Vimeo / iframe embed targets. */
    storage: string;
    volume: string;
    translations: PreviewFileTranslation[];
}

export interface PreviewChapterItem {
    id: number;
    type: ChapterItemType;
    order: number | null;
    item_id: number;
    /**
     * Whether the item should be rendered visible to the student under the current
     * (group_id, now) context. When group_id is omitted, always true.
     */
    visible_now: boolean;
    /** Echoed when a schedule exists for the (group_id, item) pair; null otherwise. */
    schedule_window: {
        start_date: number;
        end_date: number;
        is_before_start: boolean;
        expiration_check: boolean;
    } | null;
    file: PreviewFileRef | null;
    quiz: { id: number } | null;
    assignment: { id: number } | null;
}

export interface PreviewChapter {
    id: number;
    order: number | null;
    status: ChapterStatus;
    translations: { locale: Locale; title: string }[];
    items: PreviewChapterItem[];
}

export interface PreviewGroupContext {
    id: number;
    name: string;
}

export interface CoursePreviewResponseDto {
    id: number;
    slug: string;
    type: CourseType;
    status: CourseStatusFilter;
    image_cover: string;
    thumbnail: string;
    translations: PreviewTranslationRow[];
    chapters: PreviewChapter[];
    /** null when ?group_id was omitted (admin's see-everything mode). */
    group_context: PreviewGroupContext | null;
    /** Server's "now" in Unix seconds — UI uses this to render "available in N days" copy. */
    now: number;
}
