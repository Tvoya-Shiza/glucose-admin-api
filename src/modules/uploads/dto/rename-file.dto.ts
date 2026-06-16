import { IsString, Length } from 'class-validator';

/**
 * Body for `PATCH /admin-api/v1/admin/uploads/:id/rename`.
 *
 * Renames only the user-facing `original_name` (display name). The on-disk
 * ULID filename and `file_url` are immutable, so renaming never breaks a
 * reference. The service sanitizes the value before persisting.
 */
export class RenameFileDto {
    @IsString()
    @Length(1, 120)
    original_name!: string;
}
