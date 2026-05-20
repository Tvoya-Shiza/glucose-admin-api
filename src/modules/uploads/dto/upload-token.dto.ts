import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

/**
 * CRS-05 upload-token request + response.
 *
 * Phase 5 Plan 01 locked contract surface (D-13 / D-14 / D-15 from CONTEXT).
 *
 * Two-step upload flow:
 *   1. Client → admin-api: POST /admin-api/v1/admin/uploads/token with this DTO body.
 *      admin-api returns UploadTokenResponseDto.
 *   2. Client → admin-api directly: POST /admin-api/v1/admin/uploads/file
 *      with multipart body + `X-Upload-Token: <token>` header. NO BFF proxy.
 *      Browser hits admin-api host directly. Tokens are JWT-signed and
 *      scoped to actor.id; expire in 5 minutes.
 *
 * Plan 04 (file upload) IMPLEMENTATION NOTES:
 *   - Token signed with JWT_ADMIN_SECRET (separate from access-token secret? — Plan 04 decides).
 *     Claims: { sub: actor.id, kind, size, content_type, jti, exp }.
 *   - TTL: 300 seconds (5 minutes).
 *   - File size limits per CONTEXT D-15: image 10MB, video 200MB.
 *   - MIME whitelist: image/jpeg, image/png, image/webp, video/mp4, video/webm.
 *   - Disk path on save: /var/data/glucose-uploads/courses/<ulid>.<ext>.
 *   - Served by nginx static at /static/courses/<ulid>.<ext>.
 *   - Antivirus scanning DEFERRED (CONTEXT D-16) — meta logged av_scanned: false.
 */

// Re-export shared-types so existing imports of these types from this DTO
// continue to compile while the canonical definition lives in
// `@shared/uploads`. New code should import from `@shared/uploads` directly.
export type { UploadKind, UploadContentType } from '@shared/uploads';
import type { UploadKind, UploadContentType } from '@shared/uploads';

// Class-validator needs literal arrays at decorator-evaluation time. These
// MUST stay in lockstep with the canonical unions in `@shared/uploads`.
const UPLOAD_KIND_VALUES = ['image', 'video', 'cover', 'document'] as const;
const UPLOAD_CONTENT_TYPE_VALUES = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'video/mp4',
    'video/webm',
    // Phase 14 — documents.
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'application/zip',
] as const;

export class UploadTokenRequestDto {
    @IsIn(UPLOAD_KIND_VALUES)
    kind!: UploadKind;

    @IsInt()
    @Min(1)
    size!: number;

    @IsString()
    @IsIn(UPLOAD_CONTENT_TYPE_VALUES)
    content_type!: UploadContentType;

    /**
     * Phase 10 — optional destination folder. Omitted / null = root (legacy
     * disk path `/static/courses/<ulid>.<ext>`). When set, the service stamps
     * `folder_id` + `folder_path` into the token claim and writes the file
     * into `baseDir/<folder.path>/<ulid>.<ext>`.
     */
    @IsOptional()
    @IsInt()
    @Min(1)
    folder_id?: number | null;
}

export interface UploadTokenResponseDto {
    upload_url: string;
    token: string;
    expires_at: number;
    max_size: number;
    allowed_content_types: string[];
}
