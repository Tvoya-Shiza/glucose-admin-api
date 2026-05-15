import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * BLG-02 — blog category upsert DTO (Phase 7 Plan 04).
 *
 * Schema (Plan 01 lock):
 *   - BlogCategory: id ONLY. NO `slug` column — diverges from StoryCategory and
 *     AdvertisementCategory (both have slug). DO NOT add a slug field here without
 *     a matching schema migration in glucose-api.
 *   - BlogCategoryTranslation: per-locale title (`String VARCHAR(255)`), no description.
 *   - NO @@unique on translations — service must use find-then-update.
 *
 * Translation policy: KZ-only. Single title field bound directly to the
 * create/edit dialog input (no translations[] or RU companion).
 */
export class UpsertBlogCategoryDto {
    @IsOptional()
    @IsString()
    @MaxLength(255)
    title_kz?: string;
}
