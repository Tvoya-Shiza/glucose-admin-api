import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    InternalServerErrorException,
    Logger,
    NotFoundException,
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
import { PrismaService } from '../../prisma/prisma.service';
import { ListUploadsQueryDto, type ListUploadsResponseDto, type UploadAssetDto } from './dto/list-uploads.dto';
import { UploadTokenRequestDto, UploadTokenResponseDto } from './dto/upload-token.dto';
import { FoldersService } from './folders/folders.service';
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
        private readonly prisma: PrismaService,
        private readonly folders: FoldersService,
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

    async issueToken(actor: AuthenticatedRequestUser, dto: UploadTokenRequestDto): Promise<UploadTokenResponseDto> {
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

        // Phase 10 — resolve folder if requested. We pre-resolve at sign-time so
        // a deleted/renamed folder is caught BEFORE the browser uploads a 200MB
        // file, and so the claim carries an immutable snapshot of `folder_path`.
        let folder_id: number | null = null;
        let folder_path = '';
        if (dto.folder_id != null) {
            const resolved = await this.folders.resolveActiveFolderOrFail(dto.folder_id);
            folder_id = resolved.id;
            folder_path = resolved.path;
        }

        const { token, expires_at } = signUploadToken(
            {
                sub: actor.id,
                role: actor.role_name,
                role_id: actor.role_id,
                kind: dto.kind,
                size: dto.size,
                content_type: dto.content_type,
                folder_id,
                folder_path,
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
        // Phase 10 — resolve destination directory from claim. Empty `folder_path`
        // (legacy / root) writes to baseDir as before.
        const folderPath = claims.folder_path ?? '';
        const targetDir = folderPath === '' ? this.baseDir : path.join(this.baseDir, folderPath);
        const fullPath = path.join(targetDir, filename);

        // Step 5: belt-and-braces path-traversal defense — even though id+ext are
        // safe, verify the resolved path stays inside baseDir. Folder slugs are
        // already validated by FoldersService.slugify; this is a second line.
        const resolved = path.resolve(fullPath);
        const baseResolved = path.resolve(this.baseDir);
        if (!resolved.startsWith(baseResolved + path.sep)) {
            throw new InternalServerErrorException('upload.path_resolution_failed');
        }

        // Step 6: ensure the destination directory exists, then write.
        try {
            if (folderPath !== '') {
                await fs.mkdir(targetDir, { recursive: true, mode: 0o750 });
            }
            await fs.writeFile(fullPath, file.buffer, { mode: 0o640 });
        } catch (err) {
            this.logger.error(`upload write failed: ${(err as Error).message}`);
            throw new InternalServerErrorException('upload.write_failed');
        }

        const file_url =
            folderPath === ''
                ? `${this.publicUrlPrefix}/${filename}`
                : `${this.publicUrlPrefix}/${folderPath}/${filename}`;

        // Step 7: register in upload_assets so the admin file-library can list/delete.
        // Failure here is non-fatal — the file is on disk + the audit row already
        // captures the upload — but log the error so ops sees the desync.
        try {
            await this.prisma.uploadAsset.create({
                data: {
                    id,
                    actor_id: claims.sub,
                    folder_id: claims.folder_id ?? null,
                    kind: claims.kind,
                    mime: claims.content_type,
                    size: file.size,
                    filename,
                    file_url,
                    original_name: UploadsService.sanitizeOriginalName(file.originalname),
                },
            });
        } catch (err) {
            this.logger.error(`upload_assets insert failed for ${id}: ${(err as Error).message}`);
        }

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

    /**
     * List uploads for the admin file-library UI.
     *
     * - Staff-only (admin/teacher/curator) — controller enforces with @Roles.
     * - `mine=true` narrows to the calling actor (used by the "My uploads" tab).
     * - Soft-deleted rows are hidden.
     * - Page bounds clamped in the DTO via class-validator.
     */
    async listUploads(actor: AuthenticatedRequestUser, query: ListUploadsQueryDto): Promise<ListUploadsResponseDto> {
        const page = Math.max(1, query.page ?? 1);
        const perPage = Math.min(100, Math.max(1, query.per_page ?? 24));
        const where: Record<string, unknown> = { deleted_at: null };
        if (query.kind) {
            where.kind = query.kind;
        }
        if (query.mime) {
            where.mime = query.mime;
        }
        if (query.mine) {
            where.actor_id = actor.id;
        }
        if (query.q) {
            where.original_name = { contains: query.q };
        }
        if (query.folder_id === 'root') {
            where.folder_id = null;
        } else if (query.folder_id !== undefined) {
            const numericId = Number.parseInt(query.folder_id, 10);
            if (Number.isFinite(numericId) && numericId > 0) {
                where.folder_id = numericId;
            }
        }

        const [rows, total] = await Promise.all([
            this.prisma.uploadAsset.findMany({
                where,
                orderBy: { created_at: 'desc' },
                skip: (page - 1) * perPage,
                take: perPage,
                include: { folder: { select: { id: true, path: true } } },
            }),
            this.prisma.uploadAsset.count({ where }),
        ]);

        const data: UploadAssetDto[] = rows.map((row) => ({
            id: row.id,
            actor_id: row.actor_id,
            folder_id: row.folder_id,
            folder_path: row.folder?.path ?? null,
            kind: row.kind as UploadKind,
            mime: row.mime,
            size: row.size,
            filename: row.filename,
            file_url: row.file_url,
            original_name: row.original_name,
            created_at: row.created_at.toISOString(),
        }));

        return { data, meta: { total, page, per_page: perPage } };
    }

    /**
     * Soft-delete an upload + best-effort unlink the on-disk file.
     *
     * Staff-only (admin/teacher) — curators can list but not delete; controller
     * enforces with @Roles. Idempotent: a second call on a soft-deleted row
     * returns 404 (the row is no longer "visible").
     *
     * The file_url is intentionally NOT searched against feature tables
     * (banners.image / courses.image_cover / etc.) — see Phase B safety notes.
     * UI warns the user before calling this.
     */
    async deleteUpload(id: string): Promise<void> {
        const row = await this.prisma.uploadAsset.findFirst({
            where: { id, deleted_at: null },
            include: { folder: { select: { path: true } } },
        });
        if (!row) {
            throw new NotFoundException('upload.asset_not_found');
        }

        // Phase 10 — disk path is baseDir + optional folder.path + filename.
        // Belt-and-braces path-traversal defense, mirroring acceptUpload.
        const folderPath = row.folder?.path ?? '';
        const fullPath = folderPath === ''
            ? path.resolve(this.baseDir, row.filename)
            : path.resolve(this.baseDir, folderPath, row.filename);
        const baseResolved = path.resolve(this.baseDir);
        if (!fullPath.startsWith(baseResolved + path.sep)) {
            throw new ForbiddenException('upload.path_resolution_failed');
        }

        await this.prisma.uploadAsset.update({
            where: { id },
            data: { deleted_at: new Date() },
        });

        try {
            await fs.unlink(fullPath);
        } catch (err) {
            const code = (err as NodeJS.ErrnoException).code;
            if (code === 'ENOENT') {
                this.logger.warn(`upload ${id} already missing on disk during delete`);
            } else {
                this.logger.error(`upload ${id} unlink failed: ${(err as Error).message}`);
            }
        }
    }

    /**
     * Phase 10 — move an upload to a different folder (or root).
     *
     * Atomically:
     *   1. validates the target folder exists (or null = root)
     *   2. computes new file_url + on-disk path
     *   3. fs.rename inside a Prisma transaction so DB+disk stay consistent
     *
     * Idempotent at the API level: moving to the current folder is a no-op.
     */
    async moveFile(id: string, targetFolderId: number | null): Promise<UploadAssetDto> {
        const row = await this.prisma.uploadAsset.findFirst({
            where: { id, deleted_at: null },
            include: { folder: { select: { id: true, path: true } } },
        });
        if (!row) {
            throw new NotFoundException('upload.asset_not_found');
        }

        let targetPath = '';
        let targetIdValue: number | null = null;
        if (targetFolderId != null) {
            const resolved = await this.folders.resolveActiveFolderOrFail(targetFolderId);
            targetIdValue = resolved.id;
            targetPath = resolved.path;
        }

        const currentPath = row.folder?.path ?? '';
        if ((row.folder_id ?? null) === targetIdValue) {
            return {
                id: row.id,
                actor_id: row.actor_id,
                folder_id: row.folder_id,
                folder_path: row.folder?.path ?? null,
                kind: row.kind as UploadKind,
                mime: row.mime,
                size: row.size,
                filename: row.filename,
                file_url: row.file_url,
                original_name: row.original_name,
                created_at: row.created_at.toISOString(),
            };
        }

        const oldFullPath = currentPath === ''
            ? path.join(this.baseDir, row.filename)
            : path.join(this.baseDir, currentPath, row.filename);
        const newFullPath = targetPath === ''
            ? path.join(this.baseDir, row.filename)
            : path.join(this.baseDir, targetPath, row.filename);

        const baseResolved = path.resolve(this.baseDir);
        if (!path.resolve(newFullPath).startsWith(baseResolved + path.sep)) {
            throw new InternalServerErrorException('upload.path_resolution_failed');
        }

        const newFileUrl =
            targetPath === ''
                ? `${this.publicUrlPrefix}/${row.filename}`
                : `${this.publicUrlPrefix}/${targetPath}/${row.filename}`;

        const updated = await this.prisma.$transaction(async (tx) => {
            const u = await tx.uploadAsset.update({
                where: { id: row.id },
                data: { folder_id: targetIdValue, file_url: newFileUrl },
                include: { folder: { select: { id: true, path: true } } },
            });
            try {
                if (targetPath !== '') {
                    await fs.mkdir(path.dirname(newFullPath), { recursive: true, mode: 0o750 });
                }
                await fs.rename(oldFullPath, newFullPath);
            } catch (err) {
                const code = (err as NodeJS.ErrnoException).code;
                if (code === 'ENOENT') {
                    // File on disk is gone — DB row was already orphaned. Log + continue
                    // so the move semantically completes; cleanup is a separate concern.
                    this.logger.warn(`moveFile: file already missing on disk for ${row.id}`);
                } else {
                    this.logger.error(`moveFile rename failed (${oldFullPath} -> ${newFullPath}): ${(err as Error).message}`);
                    throw new InternalServerErrorException('upload.move_failed');
                }
            }
            return u;
        });

        return {
            id: updated.id,
            actor_id: updated.actor_id,
            folder_id: updated.folder_id,
            folder_path: updated.folder?.path ?? null,
            kind: updated.kind as UploadKind,
            mime: updated.mime,
            size: updated.size,
            filename: updated.filename,
            file_url: updated.file_url,
            original_name: updated.original_name,
            created_at: updated.created_at.toISOString(),
        };
    }

    /**
     * Sanitize a user-supplied original filename for safe storage in DB + UI search.
     * Keeps the visual character of the name while stripping any path/control bytes.
     */
    private static sanitizeOriginalName(raw: string | undefined): string | null {
        if (!raw || typeof raw !== 'string') {
            return null;
        }
        const trimmed = raw.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
        return trimmed.length > 0 ? trimmed : null;
    }
}
