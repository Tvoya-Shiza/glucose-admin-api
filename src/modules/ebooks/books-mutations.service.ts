import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { apiResponse } from '../../common/utils/api-response';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { CreateBookDto } from './dto/create-book.dto';
import { UpdateBookDto } from './dto/update-book.dto';
import { PublishBookDto } from './dto/publish-book.dto';
import { BooksService } from './books.service';
import { EbooksCacheService } from './utils/ebooks-cache.service';
import { EBOOKS_INVALIDATE_PATTERN, EBOOKS_PUBLIC_INVALIDATE_PATTERN } from './utils/ebooks-cache';
import { EbooksSearchIndexService } from './search/search-index.service';

/**
 * Phase 39/40 — ebook create / update / soft-delete / publish.
 *
 * Storage:
 *   - Book row holds facets (subject_id, publisher_id, grade, language, authors, year,
 *     cover_image, page_count, status) + timestamps + deleted_at.
 *   - kz title/description live in book_translations (locale='kz').
 *
 * Born DRAFT: create() defaults status='draft'. A book with page_count=0 can never be
 * 'active' — both create() (status='active' requested with no pages) and publish() enforce
 * the same gate → 409 'ebooks.publish_blocked'.
 *
 * Soft delete: DELETE sets deleted_at + status='inactive' (children preserved). Publishing
 * to 'active' clears deleted_at (restore + publish).
 *
 * Search index (best-effort, fire-and-forget AFTER the MySQL tx commits — never blocks the
 * mutation, never fails it when Postgres is down):
 *   - publish → active  : reindexBook (full rebuild)
 *   - soft delete        : removeBook (de-index)
 * Plain metadata PATCH does NOT auto-reindex (use PATCH :id/publish or POST :id/reindex).
 *
 * Cache: every mutation nukes `geonline-admin:ebooks:*` AND the public `geonline:books:*`
 * namespace (shared Redis — precedent: BLOGS_PUBLIC_INVALIDATE_PATTERN).
 */
@Injectable()
export class BooksMutationsService {
    private readonly logger = new Logger(BooksMutationsService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly booksService: BooksService,
        private readonly cache: EbooksCacheService,
        private readonly searchIndex: EbooksSearchIndexService,
    ) {}

    public async create(actor: ScopeActor, dto: CreateBookDto) {
        void actor; // access governed by @Roles + @RequirePermission('ebooks.create')
        await this.assertSubjectExists(dto.subject_id);
        await this.assertPublisherExists(dto.publisher_id);

        const status = dto.status ?? 'draft';
        // A brand-new book has zero pages — it can never be born 'active'.
        if (status === 'active') {
            throw new ConflictException({ status: 'ebooks.publish_blocked', message: 'ebooks.publish_blocked', page_count: 0 });
        }

        const now = nowSec();
        const created: any = await this.prisma.$transaction(async (tx) => {
            const book: any = await tx.book.create({
                data: {
                    subject_id: dto.subject_id ?? null,
                    publisher_id: dto.publisher_id ?? null,
                    grade: dto.grade ?? null,
                    language: dto.language ?? 'kz',
                    authors: dto.authors ?? null,
                    year: dto.year ?? null,
                    cover_image: dto.cover_image ?? null,
                    page_count: 0,
                    status,
                    created_at: now,
                },
                select: { id: true },
            });

            await tx.bookTranslation.create({
                data: {
                    book_id: book.id,
                    locale: 'kz',
                    title: dto.title,
                    description: dto.description ?? null,
                },
            });

            return book;
        });

        await this.invalidate();
        return apiResponse(1, 'created', 'ebooks.created', await this.booksService.readDetail(Number(created.id)));
    }

    public async update(actor: ScopeActor, id: number, dto: UpdateBookDto) {
        void actor;
        await this.assertBook(id);

        if (dto.subject_id !== undefined && dto.subject_id !== null) await this.assertSubjectExists(dto.subject_id);
        if (dto.publisher_id !== undefined && dto.publisher_id !== null) await this.assertPublisherExists(dto.publisher_id);

        // ---- books-row diff (null clears nullable columns) ----
        const bookData: Record<string, unknown> = {};
        if (dto.subject_id !== undefined) bookData.subject_id = dto.subject_id;
        if (dto.publisher_id !== undefined) bookData.publisher_id = dto.publisher_id;
        if (dto.grade !== undefined) bookData.grade = dto.grade;
        if (dto.year !== undefined) bookData.year = dto.year;
        if (dto.cover_image !== undefined) bookData.cover_image = dto.cover_image;
        if (typeof dto.language === 'string') bookData.language = dto.language;
        // undefined = unchanged, null = clear, string = set (see UpdateBookDto).
        if (dto.authors !== undefined) bookData.authors = dto.authors;

        // ---- book_translations (kz) diff ----
        const translationData: Record<string, unknown> = {};
        if (typeof dto.title === 'string') translationData.title = dto.title;
        if (dto.description !== undefined) translationData.description = dto.description;

        const now = nowSec();
        await this.prisma.$transaction(async (tx) => {
            await tx.book.update({ where: { id }, data: { ...bookData, updated_at: now } });

            if (Object.keys(translationData).length > 0) {
                const row: any = await tx.bookTranslation.findFirst({
                    where: { book_id: id, locale: 'kz' },
                    select: { id: true },
                    orderBy: { id: 'asc' },
                });
                if (row) {
                    await tx.bookTranslation.update({ where: { id: row.id }, data: { ...translationData } });
                } else {
                    await tx.bookTranslation.create({
                        data: {
                            book_id: id,
                            locale: 'kz',
                            title: (translationData.title as string | undefined) ?? '',
                            description: (translationData.description as string | null | undefined) ?? null,
                        },
                    });
                }
            }
        });

        await this.invalidate();
        return apiResponse(1, 'updated', 'ebooks.updated', await this.booksService.readDetail(id));
    }

    /** Soft delete: deleted_at + status='inactive'. Children (pages/translations) preserved. */
    public async softDelete(actor: ScopeActor, id: number) {
        void actor;
        await this.assertBook(id);

        const now = nowSec();
        await this.prisma.book.update({
            where: { id },
            data: { deleted_at: now, status: 'inactive', updated_at: now },
        });

        await this.invalidate();
        // De-index — a deleted book must not remain searchable. Best-effort.
        void this.searchIndex.removeBook(id).catch((err) => this.logger.warn(`removeBook(${id}) failed: ${(err as Error).message}`));

        return apiResponse(1, 'deleted', 'ebooks.deleted', { id, status: 'inactive', deleted: true });
    }

    public async publish(actor: ScopeActor, id: number, dto: PublishBookDto) {
        void actor;
        const existing = await this.assertBook(id);

        if (dto.status === 'active' && Number(existing.page_count) === 0) {
            throw new ConflictException({
                status: 'ebooks.publish_blocked',
                message: 'ebooks.publish_blocked',
                page_count: 0,
            });
        }

        const now = nowSec();
        const updated: any = await this.prisma.book.update({
            where: { id },
            data: {
                status: dto.status,
                updated_at: now,
                // Publishing active restores a soft-deleted book.
                ...(dto.status === 'active' ? { deleted_at: null } : {}),
            },
            select: { id: true, status: true },
        });

        await this.invalidate();

        // Enqueue a full reindex only on a real transition INTO 'active'.
        if (dto.status === 'active' && existing.status !== 'active') {
            void this.searchIndex.reindexBook(id).catch((err) => this.logger.warn(`reindexBook(${id}) failed: ${(err as Error).message}`));
        }

        return apiResponse(1, 'updated', 'ebooks.publish_updated', { id: Number(updated.id), status: updated.status });
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private async assertBook(id: number): Promise<{ id: number; status: string; page_count: number; deleted_at: number | null }> {
        const row: any = await this.prisma.book.findUnique({
            where: { id },
            select: { id: true, status: true, page_count: true, deleted_at: true },
        });
        if (!row) throw new NotFoundException('ebooks.not_found');
        return {
            id: Number(row.id),
            status: row.status,
            page_count: Number(row.page_count ?? 0),
            deleted_at: row.deleted_at == null ? null : Number(row.deleted_at),
        };
    }

    private async assertSubjectExists(subjectId: number | null | undefined): Promise<void> {
        if (subjectId == null) return;
        const subject = await this.prisma.quizSubject.findUnique({ where: { id: subjectId }, select: { id: true } });
        if (!subject) throw new BadRequestException('ebooks.subject_not_found');
    }

    private async assertPublisherExists(publisherId: number | null | undefined): Promise<void> {
        if (publisherId == null) return;
        const publisher = await this.prisma.publisher.findUnique({ where: { id: publisherId }, select: { id: true } });
        if (!publisher) throw new BadRequestException('ebooks.publisher_not_found');
    }

    private async invalidate(): Promise<void> {
        await this.cache.invalidate(EBOOKS_INVALIDATE_PATTERN);
        await this.cache.invalidate(EBOOKS_PUBLIC_INVALIDATE_PATTERN);
    }
}

function nowSec(): number {
    return Math.floor(Date.now() / 1000);
}
