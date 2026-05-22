import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * Body DTO for POST + PATCH on /admin-api/v1/admin/courses/categories[/:id].
 *
 * Locked field set per the admin-client course CRUD plan: slug + KZ title only.
 * Hierarchy (parent_id), ordering (order), and icon are not editable from the UI
 * yet — those live in the schema (WebinarCategory) but adding inputs for them
 * waits until the operator workflow actually needs them.
 *
 * `slug` is required on create; PATCH leaves it optional (no field = no change).
 * The service layer applies the same rules to both endpoints — the only
 * difference is that POST treats `title_kz` as required-when-non-blank and
 * PATCH treats it as optional. We keep both fields optional on the DTO to keep
 * the signature shared; service enforces "POST requires slug".
 */
export class UpsertCourseCategoryDto {
    @IsOptional()
    @IsString()
    @MinLength(1)
    @MaxLength(255)
    @Matches(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i, {
        message: 'slug_invalid_format',
    })
    slug?: string;

    @IsOptional()
    @IsString()
    @MaxLength(255)
    title_kz?: string;
}
