import { Type } from 'class-transformer';
import { IsBooleanString, IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import type { UploadKind } from '../upload-token.signer';

/**
 * Query DTO for `GET /admin-api/v1/admin/uploads`.
 *
 * All fields optional; with no filters, lists the most recent uploads across
 * all staff actors. `mine=true` is the only filter that consumes req.user.id
 * (see UploadsService.listUploads).
 *
 * The MIME whitelist mirrors the value used by the upload service so callers
 * can't ask the DB to scan for arbitrary strings (cheap defense-in-depth on
 * top of the index — `mime` has VARCHAR(64) and an explicit equality filter).
 */
export class ListUploadsQueryDto {
    @IsOptional()
    @IsIn(['image', 'video', 'cover'])
    kind?: UploadKind;

    @IsOptional()
    @IsIn(['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm'])
    mime?: string;

    @IsOptional()
    @IsString()
    @MaxLength(120)
    q?: string;

    @IsOptional()
    // class-validator-style boolean parsing — the controller receives the raw
    // string 'true' / 'false' from the querystring and the @Type(Boolean) below
    // converts it. IsBooleanString narrows the input space.
    @IsBooleanString()
    @Type(() => Boolean)
    mine?: boolean;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    per_page?: number;
}

export interface UploadAssetDto {
    id: string;
    actor_id: number;
    kind: UploadKind;
    mime: string;
    size: number;
    filename: string;
    file_url: string;
    original_name: string | null;
    created_at: string; // ISO-8601
}

export interface ListUploadsResponseDto {
    data: UploadAssetDto[];
    meta: {
        total: number;
        page: number;
        per_page: number;
    };
}
