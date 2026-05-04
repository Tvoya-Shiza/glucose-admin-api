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
 * STY-01 — upsert-story DTOs (Phase 7 Plan 02).
 *
 * `UpsertStoryDto` is used both for POST (create — required fields enforced via
 * @IsNotEmpty-style validators) and PATCH (update — all fields permitted as
 * optional via the controller mapping `Partial<UpsertStoryDto>` semantically).
 * Service code differentiates create vs update by call site, not by DTO shape.
 *
 * Schema-truth (Plan 01 lock):
 *   - Story.status: BlogStatus enum ('pending' | 'publish'); default 'pending'.
 *   - Story.image / icon / video are all `String?` (nullable) — admit `null` to clear.
 *   - StoryTranslation has NO @@unique([story_id, locale]) — service uses
 *     find-then-update inside $transaction.
 *   - StoryTranslation.description is `Text` (NOT NULL); .content is `LongText` (NOT NULL).
 *
 * Translations: 1..2 entries, locale narrowed to 'ru' | 'kz' at the API boundary.
 */
export type StoryLocale = 'ru' | 'kz';
export type StoryStatusInput = 'pending' | 'publish';

export class StoryTranslationDto {
    @IsIn(['ru', 'kz'])
    locale!: StoryLocale;

    @IsString()
    @MaxLength(255)
    title!: string;

    @IsString()
    @MaxLength(2000)
    description!: string;

    @IsString()
    @MaxLength(50000)
    content!: string;
}

export class UpsertStoryDto {
    /** kebab-style slug; admin-api re-validates on the service path. */
    @IsOptional()
    @IsString()
    @MaxLength(255)
    slug?: string;

    @IsOptional()
    @IsInt()
    @Min(1)
    category_id?: number;

    /** image url; null clears (the column is nullable). */
    @IsOptional()
    @IsString()
    @MaxLength(255)
    image?: string | null;

    @IsOptional()
    @IsString()
    @MaxLength(255)
    icon?: string | null;

    @IsOptional()
    @IsString()
    @MaxLength(255)
    video?: string | null;

    @IsOptional()
    @IsIn(['pending', 'publish'])
    status?: StoryStatusInput;

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
    @Type(() => StoryTranslationDto)
    translations?: StoryTranslationDto[];
}
