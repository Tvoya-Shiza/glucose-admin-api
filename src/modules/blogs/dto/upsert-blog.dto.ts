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
    MaxLength,
    Min,
    ValidateNested,
} from 'class-validator';

/**
 * BLG-01 — upsert-blog DTOs (Phase 7 Plan 04).
 *
 * Schema-truth (Plan 01 lock):
 *   - Blog.status: BlogStatus enum ('pending' | 'publish'); default 'pending'.
 *   - Blog has `image` ONLY (no icon, no video — diverges from Story/Advertisement).
 *   - Blog.image is `String?` (nullable) — admit `null` to clear.
 *   - BlogTranslation has NO @@unique([blog_id, locale]) — service uses
 *     find-then-update inside $transaction.
 *   - BlogTranslation.description is `Text` (NOT NULL).
 *   - BlogTranslation.content is `LongText` (NOT NULL) — Tiptap HTML target.
 *     Sanitized server-side via sanitizeBlogHtmlServer BEFORE persisting (T-07-04-02).
 *   - Blog.author_id is set server-side from actor.id on create; updated only via
 *     the dedicated PATCH /:id/author endpoint (BLG-03).
 *
 * Translations: 1..2 entries, locale narrowed to 'ru' | 'kz'. content max increased
 * to 200_000 chars to accept rich Tiptap output (D-04 — same posture as Phase 5
 * Plan 05 FileTranslation.description).
 */
export type BlogLocale = 'kz';
export type BlogStatusInput = 'pending' | 'publish';

export class BlogTranslationDto {
    // 'ru' accepted for backward compatibility; service filters RU out before persisting.
    @IsIn(['ru', 'kz'])
    locale!: 'ru' | 'kz';

    @IsString()
    @MaxLength(255)
    title!: string;

    @IsString()
    @MaxLength(2000)
    description!: string;

    /**
     * Tiptap HTML body. Sanitized server-side via `sanitizeBlogHtmlServer` inside
     * `$transaction` BEFORE the BlogTranslation row is written (T-07-04-02 mitigation).
     */
    @IsString()
    @MaxLength(200000)
    content!: string;
}

export class UpsertBlogDto {
    @IsOptional()
    @IsString()
    @MaxLength(255)
    slug?: string;

    @IsOptional()
    @IsInt()
    @Min(1)
    category_id?: number;

    /** Cover image URL; null clears (the column is nullable). */
    @IsOptional()
    @IsString()
    @MaxLength(255)
    image?: string | null;

    @IsOptional()
    @IsIn(['pending', 'publish'])
    status?: BlogStatusInput;

    @IsOptional()
    @IsBoolean()
    enable_comment?: boolean;

    @IsOptional()
    @IsString()
    @MaxLength(255)
    link_type?: string | null;

    @IsOptional()
    @IsString()
    @MaxLength(255)
    page_type?: string | null;

    @IsOptional()
    @IsString()
    @MaxLength(255)
    link?: string | null;

    @IsOptional()
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(2)
    @ValidateNested({ each: true })
    @Type(() => BlogTranslationDto)
    translations?: BlogTranslationDto[];
}
