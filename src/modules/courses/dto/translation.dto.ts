import { IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';

/**
 * TranslationDto — per-locale title + (optional) description for Webinar / WebinarChapter.
 *
 * Phase 5 Plan 01 — locked contract surface.
 * Reused by:
 *   - CreateCourseDto.translations[] / UpdateCourseDto.translations[] (Webinar level)
 *   - UpsertChapterDto.translations[] (chapter title only — chapter has no description in schema)
 *   - CourseDetailDto.translations / Chapter.translations (response surface)
 *
 * Schema-truth note (Plan 01 reconciliation table):
 *   - WebinarTranslations.locale is `String @db.VarChar(255)` — schema does NOT enforce ru|kz.
 *     This DTO narrows it via @IsIn(['ru','kz']) at the API boundary; service layer writes the literal.
 *   - WebinarTranslations.description is `LongText` (NULLABLE) — large body OK; @MaxLength(65535) tames request size.
 *   - There is NO @@unique([webinar_id, locale]) — Plan 03+ services dedup via find-then-create/update.
 *   - There is NO WebinarChapterItemTranslations model — per-locale rich text for items lives in
 *     FileTranslations.description (handled by upsert-item.dto.ts; this DTO is reused only at the
 *     Webinar + WebinarChapter levels and at the FileTranslations level).
 */
export type Locale = 'ru' | 'kz';

export class TranslationDto {
    @IsIn(['ru', 'kz'])
    locale!: Locale;

    @IsString()
    @Length(1, 255)
    title!: string;

    @IsOptional()
    @IsString()
    @MaxLength(65535)
    description?: string;
}
