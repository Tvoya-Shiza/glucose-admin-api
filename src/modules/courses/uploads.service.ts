import {
    BadRequestException,
    ConflictException,
    Injectable,
    InternalServerErrorException,
    Logger,
    OnModuleInit,
    UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRedis } from '@nestjs-modules/ioredis';
import type Redis from 'ioredis';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ulid } from 'ulid';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { UploadTokenRequestDto, UploadTokenResponseDto } from './dto/upload-token.dto';
import {
    signUploadToken,
    verifyUploadToken,
    type UploadKind,
    type UploadTokenClaims,
} from './upload-token.signer';

/**
 * UploadsService — CRS-05 (Phase 5 Plan 04).
 *
 * Two-step BFF-bypass upload flow per CONTEXT D-13:
 *   1. issueToken: actor (admin/teacher) requests a 5-min JWT scoped to one
 *      file (kind + size + content_type). Token signed with JWT_UPLOAD_SECRET
 *      (NOT the admin access-token secret — confused-deputy mitigation T-05-42).
 *   2. acceptUpload: browser POSTs multipart/form-data + X-Upload-Token directly
 *      to admin-api (no BFF proxy). Service verifies signature/expiry, enforces
 *      single-use jti via Redis SET NX EX, validates file vs claims, writes to
 *      disk with ULID filename + MIME-derived ext (path-traversal defense
 *      T-05-32), and returns the public /static/courses/<ulid>.<ext> URL.
 *
 * Antivirus scanning: DEFERRED to v2 per CONTEXT D-16. Audit meta carries
 * av_scanned: false so a future retroactive scan can target unscanned files.
 */
@Injectable()
export class UploadsService implements OnModuleInit {
    private readonly logger = new Logger(UploadsService.name);
    private readonly secret: string;
    private readonly baseDir: string;
    private readonly publicUrlPrefix: string;
    private readonly uploadUrlPath: string;

    private static readonly KIND_MAX_BYTES: Record<UploadKind, number> = {
        image: 10 * 1024 * 1024,
        cover: 10 * 1024 * 1024,
        video: 200 * 1024 * 1024,
    };

    private static readonly MIME_TO_EXT: Record<string, string> = {
        'image/jpeg': '.jpg',
        'image/png': '.png',
        'image/webp': '.webp',
        'video/mp4': '.mp4',
        'video/webm': '.webm',
    };

    private static readonly TOKEN_TTL_SECONDS = 300;

    constructor(
        config: ConfigService,
        @InjectRedis() private readonly redis: Redis,
    ) {
        const s = config.get<string>('upload.secret') ?? process.env.JWT_UPLOAD_SECRET;
        if (!s || s.length < 32) {
            throw new Error('JWT_UPLOAD_SECRET is not configured (or shorter than 32 chars) — refusing to start');
        }
        this.secret = s;
        this.baseDir =
            config.get<string>('upload.baseDir') ??
            process.env.UPLOAD_BASE_DIR ??
            '/var/data/glucose-uploads/courses';
        this.publicUrlPrefix =
            config.get<string>('upload.publicUrlPrefix') ??
            process.env.UPLOAD_PUBLIC_URL_PREFIX ??
            '/static/courses';
        this.uploadUrlPath = '/admin-api/v1/admin/uploads/file';
    }

    async onModuleInit(): Promise<void> {
        try {
            await fs.mkdir(this.baseDir, { recursive: true, mode: 0o750 });
        } catch (err) {
            // mkdir is best-effort at boot — ops may pre-create the dir with the right
            // owner/perms. Log but don't crash; failures will surface at first write.
            this.logger.warn(`upload.baseDir mkdir failed: ${(err as Error).message}`);
        }
    }

    issueToken(actor: AuthenticatedRequestUser, dto: UploadTokenRequestDto): UploadTokenResponseDto {
        const cap = UploadsService.KIND_MAX_BYTES[dto.kind];
        if (cap === undefined) {
            throw new BadRequestException('upload.kind_not_allowed');
        }
        if (dto.size > cap) {
            throw new BadRequestException(`upload.size_exceeds_kind_cap_${cap}`);
        }
        if (!UploadsService.MIME_TO_EXT[dto.content_type]) {
            throw new BadRequestException('upload.content_type_not_allowed');
        }
        const { token, expires_at } = signUploadToken(
            {
                sub: actor.id,
                role: actor.role_name,
                kind: dto.kind,
                size: dto.size,
                content_type: dto.content_type,
            },
            this.secret,
            UploadsService.TOKEN_TTL_SECONDS,
        );
        return {
            upload_url: this.uploadUrlPath,
            token,
            expires_at,
            max_size: cap,
            allowed_content_types: Object.keys(UploadsService.MIME_TO_EXT),
        };
    }

    /**
     * Accept the multipart upload bound to a previously-issued token.
     *
     * Returns both the public URL fields AND an `_audit_actor` field so the
     * AuditInterceptor can attribute the row to the token's `sub` even though
     * this route is NOT behind JwtGuard (the X-Upload-Token IS the credential
     * — admin Bearer is intentionally not trusted here per CONTEXT D-13).
     * The controller mutates `req.user` from these claims before returning so
     * AuditInterceptor (which reads req.user.id) sees the right actor.
     */
    async acceptUpload(
        token: string,
        file: Express.Multer.File | undefined,
    ): Promise<{
        file_url: string;
        content_type: string;
        size: number;
        ulid: string;
        kind: UploadKind;
        actor_id: number;
        actor_role: string;
        av_scanned: false;
    }> {
        if (!token) {
            throw new UnauthorizedException('upload.token_missing');
        }

        // Step 1: verify signature + expiry.
        let claims: UploadTokenClaims;
        try {
            claims = verifyUploadToken(token, this.secret);
        } catch (err) {
            this.logger.debug(`upload token verify failed: ${(err as Error).message}`);
            throw new UnauthorizedException('upload.token_invalid');
        }

        // Step 2: enforce single-use jti via Redis SET NX with TTL = token TTL remaining.
        const jtiKey = `geonline-admin:upload:jti:used:${claims.jti}`;
        const ttlSeconds = Math.max(1, claims.exp - Math.floor(Date.now() / 1000));
        const setResult = await this.redis.set(jtiKey, '1', 'EX', ttlSeconds, 'NX');
        if (setResult !== 'OK') {
            throw new ConflictException('upload.token_already_used');
        }

        // Step 3: validate file presence + match against token claims.
        if (!file) {
            throw new BadRequestException('upload.file_missing');
        }
        if (file.mimetype !== claims.content_type) {
            throw new BadRequestException('upload.content_type_mismatch');
        }
        if (file.size > claims.size) {
            throw new BadRequestException('upload.size_exceeds_declared');
        }
        const cap = UploadsService.KIND_MAX_BYTES[claims.kind];
        if (cap === undefined) {
            throw new BadRequestException('upload.kind_not_allowed');
        }
        if (file.size > cap) {
            throw new BadRequestException(`upload.size_exceeds_kind_cap_${cap}`);
        }

        // Step 4: derive ext from validated MIME (NEVER from upload filename — T-05-32).
        const ext = UploadsService.MIME_TO_EXT[claims.content_type];
        if (!ext) {
            throw new BadRequestException('upload.content_type_not_allowed');
        }
        const id = ulid();
        const filename = `${id}${ext}`;
        const fullPath = path.join(this.baseDir, filename);

        // Step 5: belt-and-braces path-traversal defense — even though id+ext are
        // safe, verify the resolved path stays inside baseDir.
        const resolved = path.resolve(fullPath);
        const baseResolved = path.resolve(this.baseDir);
        if (!resolved.startsWith(baseResolved + path.sep)) {
            throw new InternalServerErrorException('upload.path_resolution_failed');
        }

        // Step 6: write to disk. Multer is configured with memoryStorage on the
        // controller, so file.buffer is populated.
        try {
            await fs.writeFile(fullPath, file.buffer, { mode: 0o640 });
        } catch (err) {
            this.logger.error(`upload write failed: ${(err as Error).message}`);
            throw new InternalServerErrorException('upload.write_failed');
        }

        const file_url = `${this.publicUrlPrefix}/${filename}`;
        return {
            file_url,
            content_type: claims.content_type,
            size: file.size,
            ulid: id,
            kind: claims.kind,
            actor_id: claims.sub,
            actor_role: claims.role,
            av_scanned: false,
        };
    }
}
