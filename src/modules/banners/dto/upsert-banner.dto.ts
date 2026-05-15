import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    ArrayMinSize,
    IsArray,
    IsBoolean,
    IsIn,
    IsOptional,
    IsString,
    MaxLength,
    ValidateNested,
} from 'class-validator';

/**
 * BAN-01 — upsert-banner DTOs (Phase 7 Plan 03).
 *
 * Mirrors UpsertStoryDto (Plan 02) MINUS the `icon` field — Advertisement schema
 * has only `image` + `video`; there is no `icon` column.
 *
 * Used for both POST (create) and PATCH (update). Service code differentiates
 * create vs update by call site, not by DTO shape.
 *
 * Schema-truth (Plan 01 lock):
 *   - Advertisement.status: BlogStatus enum ('pending' | 'publish'); default 'pending'.
 *   - Advertisement.image / video are `String?` (nullable) — admit `null` to clear.
 *   - AdvertisementTranslation has NO @@unique([advertisement_id, locale]) — service
 *     uses find-then-update inside $transaction.
 *   - AdvertisementTranslation.description is `Text` (NOT NULL); .content is `LongText` (NOT NULL).
 *
 * Translations: 1..2 entries, locale narrowed to 'ru' | 'kz' at the API boundary.
 */
export type BannerLocale = 'kz';
export type BannerStatusInput = 'pending' | 'publish';

export class BannerTranslationDto {
    // 'ru' accepted for backward compatibility; service filters RU out before persisting.
    @IsIn(['ru', 'kz'])
    locale!: 'ru' | 'kz';

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

export class UpsertBannerDto {
    /** kebab-style slug; admin-api re-validates on the service path. */
    @IsOptional()
    @IsString()
    @MaxLength(255)
    slug?: string;

    /** image url; null clears (the column is nullable). */
    @IsOptional()
    @IsString()
    @MaxLength(255)
    image?: string | null;

    @IsOptional()
    @IsString()
    @MaxLength(255)
    video?: string | null;

    @IsOptional()
    @IsIn(['pending', 'publish'])
    status?: BannerStatusInput;

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
    @Type(() => BannerTranslationDto)
    translations?: BannerTranslationDto[];
}
