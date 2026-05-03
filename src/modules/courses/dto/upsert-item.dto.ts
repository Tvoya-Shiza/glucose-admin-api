import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    ArrayMinSize,
    IsArray,
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
     */
    @IsInt()
    @Min(1)
    item_id!: number;

    @IsOptional()
    @IsInt()
    @Min(0)
    order?: number;

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
}
