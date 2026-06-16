import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    ArrayMinSize,
    IsArray,
    IsBoolean,
    IsIn,
    IsInt,
    IsOptional,
    IsString,
    Length,
    Min,
    ValidateNested,
} from 'class-validator';
import { TranslationDto } from './translation.dto';

/**
 * CRS-07 chapter + item upsert payloads.
 *
 * Phase 5 Plan 01 locked contract surface.
 *
 * SCHEMA-TRUTH RECONCILIATION (executor: Plan 05 reads this header):
 *
 *   1. WebinarChapterItem.type enum = { file | quiz | assignment } (schema line 77).
 *      The CONTEXT sketch's "text | image | video" is WRONG. Resolution:
 *
 *         "text"  (rich-text item)  → type='file' + Files row with
 *                                      file_type='text/html', storage='upload',
 *                                      file='' (no upload), and FileTranslations.description
 *                                      holding sanitized Tiptap HTML PER LOCALE.
 *         "image" (image item)      → type='file' + Files row with
 *                                      storage='upload', file=<uploaded URL>,
 *                                      file_type='image/jpeg' | 'image/png' | 'image/webp'.
 *         "video" (video item)      → type='file' + Files row with
 *                                      storage='upload', file=<uploaded URL>,
 *                                      file_type='video/mp4' | 'video/webm'.
 *
 *      The WebinarChapterItem.type field stays 'file' for all three sub-types.
 *      Admin-client UI derives sub-type from `Files.file_type` MIME prefix.
 *      Plan 05 implements this mapping; Plan 06 adds 'quiz' / 'assignment' kinds.
 *
 *   2. There is NO WebinarChapterItemTranslations model.
 *      `UpsertItemDto.translations[]` (when type='file') maps to FileTranslations
 *      (file_id, locale, title, description). The service layer does the join.
 *      For type='quiz' / 'assignment' the translations[] field is IGNORED
 *      (those entities own their own translations downstream — Phase 6).
 *
 *   3. UpsertChapterDto.translations[] hits WebinarChapterTranslation
 *      (id, webinar_chapter_id, locale, title) — schema has TITLE ONLY,
 *      no description. TranslationDto.description IS IGNORED on the chapter path.
 *
 *   4. WebinarChapterItem.order and WebinarChapter.order are nullable Int
 *      (UnsignedInt). Service auto-assigns sequential orders on create when
 *      `order` is omitted (max(order)+1 within parent).
 *
 *   5. Schema has NO @@unique on (webinar_chapter_id, locale) for chapter
 *      translations — Plan 05 service dedups via find-then-update.
 */

export class UpsertChapterDto {
    /** Omit on create. Present (matching path :chapterId) on update. */
    @IsOptional()
    @IsInt()
    @Min(1)
    id?: number;

    @IsOptional()
    @IsInt()
    @Min(0)
    order?: number;

    @IsOptional()
    @IsIn(['active', 'inactive'])
    status?: 'active' | 'inactive';

    /**
     * Chapter title per locale. WebinarChapterTranslation has NO description column,
     * so TranslationDto.description is IGNORED on this path (service drops it before insert).
     */
    @IsOptional()
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(2)
    @ValidateNested({ each: true })
    @Type(() => TranslationDto)
    translations?: TranslationDto[];
}

export type UpsertItemType = 'file' | 'quiz' | 'assignment';

/**
 * Phase 29 — one PDF inside a multi-file PDF block. `file_url` is the uploaded
 * /static/courses/<ulid>.pdf path; `name` (optional) becomes the per-file label
 * (FileTranslations.title) shown on the public app.
 */
export class PdfFileInputDto {
    @IsString()
    @Length(1, 2048)
    file_url!: string;

    @IsOptional()
    @IsString()
    @Length(0, 64)
    volume?: string;

    @IsOptional()
    @IsString()
    @Length(0, 255)
    name?: string;
}

export class UpsertItemDto {
    /** Omit on create. Present (matching path :itemId) on update. */
    @IsOptional()
    @IsInt()
    @Min(1)
    id?: number;

    @IsInt()
    @Min(1)
    chapter_id!: number;

    @IsIn(['file', 'quiz', 'assignment'])
    type!: UpsertItemType;

    /**
     * FK target — Files.id when type='file', Quizzes.id when type='quiz',
     * WebinarAssignment.id when type='assignment'. Service validates the
     * referenced row exists AND belongs (transitively) to the same Webinar.
     *
     * `0` is the create-new sentinel when type='file' — the service spawns a
     * fresh Files row from (file_url, file_type, volume, storage). For 'quiz'
     * and 'assignment' the service still requires a real FK (>= 1) and throws
     * `items.{quiz,assignment}_not_found` on miss.
     */
    @IsInt()
    @Min(0)
    item_id!: number;

    @IsOptional()
    @IsInt()
    @Min(0)
    order?: number;

    /**
     * Phase 20 — per-item content-level access toggle. Maps to
     * `WebinarChapterItem.accessibility` for ALL item types ('file', 'quiz',
     * 'assignment'). For 'file' the service ALSO mirrors the value onto the
     * linked `Files.accessibility` row so direct-file routes (getFile by id)
     * keep their existing gate.
     *
     * Phase 13 (legacy): only `Files.accessibility` was honored, so this
     * field was IGNORED for quizzes/assignments. Phase 20 lifts that
     * restriction — quiz/assignment items can now be marked 'free' (visible
     * without purchase) or 'paid' (requires course access) independently.
     */
    @IsOptional()
    @IsIn(['free', 'paid'])
    accessibility?: 'free' | 'paid';

    /**
     * Only honored when type='file' — maps to FileTranslations (per-locale
     * title + description). description holds sanitized Tiptap HTML when
     * the linked Files row is a rich-text item (file_type='text/html').
     * IGNORED when type='quiz' or 'assignment'.
     */
    @IsOptional()
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(2)
    @ValidateNested({ each: true })
    @Type(() => TranslationDto)
    translations?: TranslationDto[];

    /**
     * Phase 16 — per-item "counts toward completion" flag.
     * `true` (default): the item is counted in `total` and `completed` when the
     * user-API computes course progress. `false`: optional/bonus item — visible
     * and unlockable, but excluded from the completion fraction.
     *
     * Lives on `WebinarChapterItem` (not on Files/Quizzes/Assignment) because the
     * same quiz can be wired into two courses with different obligation policies.
     */
    @IsOptional()
    @IsBoolean()
    is_required?: boolean;

    /**
     * file_url / file_type / volume / storage are honored only when type='file'.
     * On create (item_id=0) they populate the new Files row; on update they
     * patch the existing row when present (omitted = leave as-is).
     *
     * `storage` maps to the Files.storage enum — 'upload' for binary uploads,
     * 'youtube' | 'vimeo' | 'iframe' for embedded video / external iframe
     * targets. The client picks the right value via parseVideoUrl on the
     * "Video URL" tab; we forward it as a plain string and Prisma rejects
     * out-of-enum values at insert time.
     */
    @IsOptional()
    @IsString()
    @Length(0, 2048)
    file_url?: string;

    @IsOptional()
    @IsString()
    @Length(0, 128)
    file_type?: string;

    @IsOptional()
    @IsString()
    @Length(0, 64)
    volume?: string;

    @IsOptional()
    @IsIn(['upload', 'youtube', 'vimeo', 'external_link', 'google_drive', 'dropbox', 'iframe', 's3', 'upload_archive', 'secure_host'])
    storage?:
        | 'upload'
        | 'youtube'
        | 'vimeo'
        | 'external_link'
        | 'google_drive'
        | 'dropbox'
        | 'iframe'
        | 's3'
        | 'upload_archive'
        | 'secure_host';

    /**
     * Phase 29 — when present (type='file'), the item is a multi-file PDF block.
     * The service creates one Files row per entry (storage='upload',
     * file_type='application/pdf'), links them via the
     * webinar_chapter_item_pdf_files bridge (ordered), and points item_id at the
     * first. Replaces the block's previous PDFs on update.
     */
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(50)
    @ValidateNested({ each: true })
    @Type(() => PdfFileInputDto)
    pdf_files?: PdfFileInputDto[];
}
