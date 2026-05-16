import {
    BadRequestException,
    ConflictException,
    Injectable,
    InternalServerErrorException,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../../../../generated/prisma';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { AuthenticatedRequestUser } from '../../auth/jwt/jwt.strategy';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateFolderDto } from './dto/create-folder.dto';
import { MoveFolderDto } from './dto/move-folder.dto';
import { RenameFolderDto } from './dto/rename-folder.dto';
import type {
    FolderBreadcrumb,
    FolderDetailResponseDto,
    FolderDto,
    ListFoldersResponseDto,
} from './dto/folder-response.dto';

/**
 * FoldersService — Phase 10. Hierarchy of media-library folders backed by
 * file_folders + a self-reference. `path` is denormalised (slash-joined slugs)
 * so subtree operations are simple LIKE queries.
 *
 * Disk-mirror invariant:
 *   For every folder F with non-empty path, the directory `baseDir/F.path`
 *   exists on disk iff at least one file has been uploaded into the subtree.
 *   Empty folders are not pre-created on disk — UploadsService.acceptUpload
 *   does mkdir -p just before writing the first file.
 *
 * Rename / move:
 *   - DB updates (folder + descendants + upload_assets.file_url) happen in
 *     a Prisma interactive transaction.
 *   - fs.rename runs INSIDE the same transaction callback. If it throws,
 *     the transaction rolls back. ENOENT is treated as success (the dir
 *     never had any files, so there's nothing to move).
 *   - There is still a tiny window between fs.rename success and the
 *     transaction COMMIT where a process crash leaves disk + DB desynced.
 *     Documented and accepted; the FS state is deterministic from the DB
 *     state and ops can repair by re-renaming the directory.
 */
@Injectable()
export class FoldersService {
    private readonly logger = new Logger(FoldersService.name);
    private readonly baseDir: string;

    private static readonly SLUG_REGEX = /^[a-z0-9][a-z0-9-]{0,119}$/;

    constructor(config: ConfigService, private readonly prisma: PrismaService) {
        this.baseDir =
            config.get<string>('upload.baseDir') ??
            process.env.UPLOAD_BASE_DIR ??
            '/var/data/glucose-uploads/courses';
    }

    async listFolders(): Promise<ListFoldersResponseDto> {
        const rows = await this.prisma.fileFolder.findMany({
            where: { deleted_at: null },
            orderBy: [{ path: 'asc' }],
            select: {
                id: true,
                parent_id: true,
                name: true,
                slug: true,
                path: true,
                created_by: true,
                created_at: true,
                updated_at: true,
            },
        });
        if (rows.length === 0) {
            return { data: [] };
        }

        const childCounts = await this.prisma.fileFolder.groupBy({
            by: ['parent_id'],
            where: { deleted_at: null, parent_id: { not: null } },
            _count: { _all: true },
        });
        const childCountMap = new Map<number, number>();
        for (const row of childCounts) {
            if (row.parent_id !== null) {
                childCountMap.set(row.parent_id, row._count._all);
            }
        }

        const fileCounts = await this.prisma.uploadAsset.groupBy({
            by: ['folder_id'],
            where: { deleted_at: null, folder_id: { not: null } },
            _count: { _all: true },
        });
        const fileCountMap = new Map<number, number>();
        for (const row of fileCounts) {
            if (row.folder_id !== null) {
                fileCountMap.set(row.folder_id, row._count._all);
            }
        }

        const data: FolderDto[] = rows.map((row) => ({
            id: row.id,
            parent_id: row.parent_id,
            name: row.name,
            slug: row.slug,
            path: row.path,
            created_by: row.created_by,
            created_at: row.created_at.toISOString(),
            updated_at: row.updated_at.toISOString(),
            children_count: childCountMap.get(row.id) ?? 0,
            files_count: fileCountMap.get(row.id) ?? 0,
        }));
        return { data };
    }

    async getFolder(id: number): Promise<FolderDetailResponseDto> {
        const folder = await this.requireFolder(id);
        const breadcrumbs = await this.buildBreadcrumbs(folder.parent_id);
        const [children_count, files_count] = await Promise.all([
            this.prisma.fileFolder.count({ where: { parent_id: folder.id, deleted_at: null } }),
            this.prisma.uploadAsset.count({ where: { folder_id: folder.id, deleted_at: null } }),
        ]);
        return {
            folder: {
                id: folder.id,
                parent_id: folder.parent_id,
                name: folder.name,
                slug: folder.slug,
                path: folder.path,
                created_by: folder.created_by,
                created_at: folder.created_at.toISOString(),
                updated_at: folder.updated_at.toISOString(),
                children_count,
                files_count,
            },
            breadcrumbs,
        };
    }

    async createFolder(actor: AuthenticatedRequestUser, dto: CreateFolderDto): Promise<FolderDto> {
        const parent = dto.parent_id ? await this.requireFolder(dto.parent_id) : null;
        const slug = FoldersService.slugify(dto.name);
        const folderPath = parent ? `${parent.path}/${slug}` : slug;
        await this.assertNoSlugCollision(parent?.id ?? null, slug, null);

        const created = await this.prisma.fileFolder.create({
            data: {
                parent_id: parent?.id ?? null,
                name: dto.name,
                slug,
                path: folderPath,
                created_by: actor.id,
            },
        });

        return {
            id: created.id,
            parent_id: created.parent_id,
            name: created.name,
            slug: created.slug,
            path: created.path,
            created_by: created.created_by,
            created_at: created.created_at.toISOString(),
            updated_at: created.updated_at.toISOString(),
            children_count: 0,
            files_count: 0,
        };
    }

    async renameFolder(id: number, dto: RenameFolderDto): Promise<FolderDto> {
        const folder = await this.requireFolder(id);
        const newSlug = FoldersService.slugify(dto.name);
        if (newSlug === folder.slug && dto.name === folder.name) {
            // No-op rename — short-circuit.
            return this.toFolderDto(folder, 0, 0);
        }
        await this.assertNoSlugCollision(folder.parent_id, newSlug, folder.id);

        const oldPath = folder.path;
        const newPath = folder.parent_id
            ? `${oldPath.slice(0, oldPath.length - folder.slug.length)}${newSlug}`
            : newSlug;

        await this.applySubtreeRewrite(folder.id, oldPath, newPath, dto.name, newSlug);

        const updated = await this.requireFolder(id);
        const [children_count, files_count] = await Promise.all([
            this.prisma.fileFolder.count({ where: { parent_id: updated.id, deleted_at: null } }),
            this.prisma.uploadAsset.count({ where: { folder_id: updated.id, deleted_at: null } }),
        ]);
        return this.toFolderDto(updated, children_count, files_count);
    }

    async moveFolder(id: number, dto: MoveFolderDto): Promise<FolderDto> {
        const folder = await this.requireFolder(id);
        const newParent = dto.parent_id ? await this.requireFolder(dto.parent_id) : null;

        if (newParent && newParent.id === folder.id) {
            throw new BadRequestException('folder.move_self');
        }
        if (newParent) {
            // Reject if newParent is a descendant of folder (cycle).
            const cycle =
                newParent.path === folder.path ||
                newParent.path === `${folder.path}` ||
                newParent.path.startsWith(`${folder.path}/`);
            if (cycle) {
                throw new BadRequestException('folder.move_cycle');
            }
        }
        if ((newParent?.id ?? null) === folder.parent_id) {
            // Same parent — no-op.
            const [children_count, files_count] = await Promise.all([
                this.prisma.fileFolder.count({ where: { parent_id: folder.id, deleted_at: null } }),
                this.prisma.uploadAsset.count({ where: { folder_id: folder.id, deleted_at: null } }),
            ]);
            return this.toFolderDto(folder, children_count, files_count);
        }
        await this.assertNoSlugCollision(newParent?.id ?? null, folder.slug, folder.id);

        const oldPath = folder.path;
        const newPath = newParent ? `${newParent.path}/${folder.slug}` : folder.slug;

        await this.applySubtreeRewrite(folder.id, oldPath, newPath, folder.name, folder.slug, newParent?.id ?? null);

        const updated = await this.requireFolder(id);
        const [children_count, files_count] = await Promise.all([
            this.prisma.fileFolder.count({ where: { parent_id: updated.id, deleted_at: null } }),
            this.prisma.uploadAsset.count({ where: { folder_id: updated.id, deleted_at: null } }),
        ]);
        return this.toFolderDto(updated, children_count, files_count);
    }

    async deleteFolder(id: number): Promise<void> {
        const folder = await this.requireFolder(id);
        const [child_count, file_count] = await Promise.all([
            this.prisma.fileFolder.count({ where: { parent_id: folder.id, deleted_at: null } }),
            this.prisma.uploadAsset.count({ where: { folder_id: folder.id, deleted_at: null } }),
        ]);
        if (child_count > 0 || file_count > 0) {
            throw new ConflictException('folder.not_empty');
        }
        await this.prisma.fileFolder.update({
            where: { id: folder.id },
            data: { deleted_at: new Date() },
        });
        // Best-effort fs.rmdir; empty directory may not even exist (no uploads yet).
        const fullPath = this.resolveDiskPath(folder.path);
        try {
            await fs.rmdir(fullPath);
        } catch (err) {
            const code = (err as NodeJS.ErrnoException).code;
            if (code !== 'ENOENT' && code !== 'ENOTEMPTY') {
                this.logger.warn(`folder ${folder.id} rmdir failed: ${(err as Error).message}`);
            }
        }
    }

    /**
     * Look up a folder by id. Validates it exists + not soft-deleted. Used by
     * UploadsService when stamping a folder claim into the upload token.
     */
    async resolveActiveFolderOrFail(id: number): Promise<{ id: number; path: string }> {
        const folder = await this.requireFolder(id);
        return { id: folder.id, path: folder.path };
    }

    // ---- internals --------------------------------------------------------

    private async requireFolder(id: number) {
        const folder = await this.prisma.fileFolder.findFirst({
            where: { id, deleted_at: null },
        });
        if (!folder) {
            throw new NotFoundException('folder.not_found');
        }
        return folder;
    }

    private async buildBreadcrumbs(parentId: number | null): Promise<FolderBreadcrumb[]> {
        const acc: FolderBreadcrumb[] = [];
        let cursor: number | null = parentId;
        // Hard cap so a corrupted graph can't loop forever.
        for (let depth = 0; depth < 50 && cursor !== null; depth += 1) {
            const row = await this.prisma.fileFolder.findFirst({
                where: { id: cursor, deleted_at: null },
                select: { id: true, name: true, slug: true, path: true, parent_id: true },
            });
            if (!row) break;
            acc.unshift({ id: row.id, name: row.name, slug: row.slug, path: row.path });
            cursor = row.parent_id;
        }
        return acc;
    }

    private async assertNoSlugCollision(
        parentId: number | null,
        slug: string,
        excludeId: number | null,
    ): Promise<void> {
        const where: Prisma.FileFolderWhereInput = {
            parent_id: parentId,
            slug,
            deleted_at: null,
        };
        if (excludeId !== null) {
            where.id = { not: excludeId };
        }
        const existing = await this.prisma.fileFolder.findFirst({ where });
        if (existing) {
            throw new ConflictException('folder.slug_taken');
        }
    }

    /**
     * Atomic subtree rewrite. Handles both rename (same parent) and move
     * (new parent). When called for a rename the `newParentId` argument is
     * omitted so the parent_id stays untouched.
     */
    private async applySubtreeRewrite(
        folderId: number,
        oldPath: string,
        newPath: string,
        newName: string,
        newSlug: string,
        newParentId?: number | null,
    ): Promise<void> {
        const oldDisk = this.resolveDiskPath(oldPath);
        const newDisk = this.resolveDiskPath(newPath);
        const oldPrefix = `${oldPath}/`;
        const newPrefix = `${newPath}/`;
        const oldUrlPrefix = `/static/courses/${oldPath}/`; // matches publicUrlPrefix; if changed, keep in sync
        const newUrlPrefix = `/static/courses/${newPath}/`;
        const oldUrlExact = `/static/courses/${oldPath}/`;

        await this.prisma.$transaction(async (tx) => {
            // 1. update the folder itself
            await tx.fileFolder.update({
                where: { id: folderId },
                data: {
                    name: newName,
                    slug: newSlug,
                    path: newPath,
                    ...(newParentId !== undefined ? { parent_id: newParentId } : {}),
                },
            });

            // 2. update descendant folders' path
            // path used to start with oldPrefix → swap to newPrefix.
            await tx.$executeRaw`
                UPDATE file_folders
                SET path = CONCAT(${newPrefix}, SUBSTRING(path, ${oldPrefix.length + 1}))
                WHERE deleted_at IS NULL
                  AND path LIKE ${oldPrefix + '%'}
            `;

            // 3. update upload_assets.file_url for any file whose URL starts with the
            //    old folder URL prefix (whether the file is in this folder directly
            //    or in a descendant folder — both share the same URL prefix segment).
            await tx.$executeRaw`
                UPDATE upload_assets
                SET file_url = CONCAT(${newUrlPrefix}, SUBSTRING(file_url, ${oldUrlPrefix.length + 1}))
                WHERE deleted_at IS NULL
                  AND file_url LIKE ${oldUrlPrefix + '%'}
            `;

            // 4. attempt fs.rename of the on-disk directory. ENOENT is OK (no
            //    files in subtree yet). Anything else triggers transaction rollback.
            try {
                await fs.mkdir(path.dirname(newDisk), { recursive: true, mode: 0o750 });
                await fs.rename(oldDisk, newDisk);
            } catch (err) {
                const code = (err as NodeJS.ErrnoException).code;
                if (code === 'ENOENT') {
                    this.logger.debug(`fs.rename skipped (no on-disk dir yet): ${oldDisk}`);
                    return;
                }
                this.logger.error(`fs.rename failed (${oldDisk} -> ${newDisk}): ${(err as Error).message}`);
                throw new InternalServerErrorException('folder.fs_rename_failed');
            }
        });

        // Silence "oldUrlExact unused" — kept for future use (alias-table when added).
        void oldUrlExact;
    }

    private toFolderDto(
        folder: { id: number; parent_id: number | null; name: string; slug: string; path: string; created_by: number; created_at: Date; updated_at: Date },
        children_count: number,
        files_count: number,
    ): FolderDto {
        return {
            id: folder.id,
            parent_id: folder.parent_id,
            name: folder.name,
            slug: folder.slug,
            path: folder.path,
            created_by: folder.created_by,
            created_at: folder.created_at.toISOString(),
            updated_at: folder.updated_at.toISOString(),
            children_count,
            files_count,
        };
    }

    private resolveDiskPath(folderPath: string): string {
        if (folderPath === '') {
            return path.resolve(this.baseDir);
        }
        const full = path.join(this.baseDir, folderPath);
        const resolved = path.resolve(full);
        const baseResolved = path.resolve(this.baseDir);
        if (!resolved.startsWith(baseResolved + path.sep) && resolved !== baseResolved) {
            // Slug regex prevents this in practice; belt-and-braces.
            throw new InternalServerErrorException('folder.path_resolution_failed');
        }
        return resolved;
    }

    static slugify(name: string): string {
        const transliterated = FoldersService.transliterate(name).toLowerCase();
        const sanitized = transliterated
            .normalize('NFKD')
            .replace(/[̀-ͯ]/g, '') // strip combining diacritics
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 120);
        const final = sanitized.length > 0 ? sanitized : `f-${Date.now().toString(36)}`;
        if (!FoldersService.SLUG_REGEX.test(final)) {
            throw new BadRequestException('folder.slug_invalid');
        }
        return final;
    }

    private static readonly CYRILLIC_MAP: Record<string, string> = {
        а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z',
        и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
        с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch',
        ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
        // Kazakh additions
        ә: 'a', ғ: 'g', қ: 'q', ң: 'n', ө: 'o', ұ: 'u', ү: 'u', һ: 'h', і: 'i',
    };

    private static transliterate(input: string): string {
        let out = '';
        for (const ch of input.toLowerCase()) {
            out += FoldersService.CYRILLIC_MAP[ch] ?? ch;
        }
        return out;
    }
}
