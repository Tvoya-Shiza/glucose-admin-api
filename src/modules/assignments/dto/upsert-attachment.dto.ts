import { IsString, IsUrl, MaxLength, ValidateIf } from 'class-validator';

/**
 * Attachment metadata (admin-uploaded reference material for an assignment).
 * The actual upload goes through the existing /admin-api/v1/admin/uploads/file
 * flow (X-Upload-Token); this endpoint persists the resulting URL + a
 * human-readable title.
 *
 * Schema constraint: a maximum of 5 attachments per assignment, enforced in
 * the service (not at validation time — depends on existing row count).
 */
export class UpsertAttachmentDto {
    @IsString()
    @MaxLength(255)
    title!: string;

    /** Absolute URL (e.g. /uploads/2026/05/abcd.pdf or https://cdn.example.com/...). */
    @IsString()
    @MaxLength(255)
    @ValidateIf((o) => /^https?:\/\//.test(o.attach))
    @IsUrl({ require_protocol: true })
    attach!: string;
}
