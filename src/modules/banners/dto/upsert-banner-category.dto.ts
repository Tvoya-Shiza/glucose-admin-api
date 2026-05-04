import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * BAN-02 — banner category upsert DTO (Phase 7 Plan 03).
 *
 * Mirrors UpsertStoryCategoryDto (Plan 02). Schema-truth (Plan 01 lock):
 *   - AdvertisementCategory: `slug VARCHAR(255)` only (flat — no parent_id).
 *   - AdvertisementCategoryTranslation: per-locale title (`String VARCHAR(255)`),
 *     no description.
 *   - NO @@unique on translations — service must use find-then-update.
 *
 * Translation policy: RU is canonical; KZ permitted blank but the field is required
 * in the row when supplied. We accept both as separate top-level fields here (rather
 * than a translations[]) because the create/edit dialog binds them as two simple
 * inputs — far less ceremony than ValidateNested for the categories surface.
 */
export class UpsertBannerCategoryDto {
    @IsOptional()
    @IsString()
    @MaxLength(255)
    slug?: string;

    @IsOptional()
    @IsString()
    @MaxLength(255)
    title_ru?: string;

    @IsOptional()
    @IsString()
    @MaxLength(255)
    title_kz?: string;
}
