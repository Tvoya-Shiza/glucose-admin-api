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

export type UploadKind = 'image' | 'video' | 'cover';
export type UploadContentType =
    | 'image/jpeg'
    | 'image/png'
    | 'image/webp'
    | 'video/mp4'
    | 'video/webm';

export class UploadTokenRequestDto {
    @IsIn(['image', 'video', 'cover'])
    kind!: UploadKind;

    @IsInt()
    @Min(1)
    size!: number;

    @IsString()
    @IsIn(['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm'])
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
