import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/**
 * BLG-03 — author reassignment DTO (Phase 7 Plan 04 / D-11).
 *
 * Mirrors Phase 3 Plan 04 ChangeRoleDto posture for high-trust mutations:
 *   - `author_id` is the target user id; server validates `role_name IN ('admin','teacher')`.
 *   - `reason` is captured into audit meta.
 *   - `confirmation` is the type-the-id gate; service requires `confirmation === String(blog.id)`
 *     (T-07-04-04 — server is the gate, the dialog's TypeTheCountConfirmation is UX).
 */
export class ChangeBlogAuthorDto {
    @IsInt()
    @Min(1)
    author_id!: number;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    reason?: string;

    @IsOptional()
    @IsString()
    @MaxLength(50)
    confirmation?: string;
}
