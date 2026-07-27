import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { apiResponse } from '../../common/utils/api-response';
import { Prisma } from '../../../generated/prisma';
import { ReplacePagesDto } from './dto/replace-pages.dto';
import { EbooksCacheService } from './utils/ebooks-cache.service';
import { EBOOKS_INVALIDATE_PATTERN, EBOOKS_PUBLIC_INVALIDATE_PATTERN } from './utils/ebooks-cache';
import { EbooksSearchIndexService, IndexPageInput } from './search/search-index.service';
import { partitionPagesForUpsert } from './utils/page-upsert-partition';

/**
 * Phase 39/40 — book page management (book_pages).
 *
 * PUT batch-upserts pages by (book_id, page_number) with REPLACE semantics (the request
 * body is the authoritative desired state for each listed page). Upserts run as chunked
 * bulk `INSERT ... ON DUPLICATE KEY UPDATE` statements inside one $transaction (raised
 * timeout so a 2000-page batch never trips the default 5s interactive-tx limit), then
 * books.page_count is recomputed as max(page_number).
 *
 * After the MySQL tx commits, the changed pages are indexed into Postgres (best-effort,
 * fire-and-forget). page listing computes `has_text` in SQL so the potentially huge
 * MediumText column is never transferred.
 */
@Injectable()
export class BookPagesService {
    private readonly logger = new Logger(BookPagesService.name);

    /** Rows per bulk INSERT — bounds statement size / max_allowed_packet with big page text. */
    private static readonly UPSERT_CHUNK = 100;

    constructor(
        private readonly prisma: PrismaService,
        private readonly cache: EbooksCacheService,
        private readonly searchIndex: EbooksSearchIndexService,
    ) {}

    public async list(bookId: number) {
        await this.assertBook(bookId);
        const rows: any[] = await this.prisma.$queryRaw`
            SELECT page_number AS page_number,
                   image_url AS image_url,
                   (text_content IS NOT NULL AND CHAR_LENGTH(text_content) > 0) AS has_text
            FROM book_pages
            WHERE book_id = ${bookId}
            ORDER BY page_number ASC
        `;
        return {
            rows: rows.map((r) => ({
                page_number: Number(r.page_number),
                image_url: r.image_url ?? null,
                has_text: !!Number(r.has_text),
            })),
            total: rows.length,
        };
    }

    public async replacePages(bookId: number, dto: ReplacePagesDto) {
        await this.assertBook(bookId);

        // Dedupe by page_number (last occurrence wins) so one batch never self-conflicts.
        const byNumber = new Map<number, { page_number: number; image_url?: string | null; text_content?: string | null }>();
        for (const p of dto.pages) byNumber.set(p.page_number, p);
        const pages = [...byNumber.values()];

        const now = nowSec();
        // Per-field merge (as documented on ReplacePagesDto): a field absent from the entry
        // must NOT be written on an existing row — otherwise an image-only edit would NULL
        // the page's OCR text, which the list endpoint never returns and the client
        // therefore cannot round-trip. See utils/page-upsert-partition.ts.
        const partitions = partitionPagesForUpsert(pages);

        const pageCount = await this.prisma.$transaction(
            async (tx) => {
                for (const partition of partitions) {
                    const assignments = [
                        ...(partition.setImage ? [Prisma.sql`image_url = VALUES(image_url)`] : []),
                        ...(partition.setText ? [Prisma.sql`text_content = VALUES(text_content)`] : []),
                        Prisma.sql`updated_at = VALUES(updated_at)`,
                    ];
                    for (const group of chunk(partition.rows, BookPagesService.UPSERT_CHUNK)) {
                        const tuples = group.map(
                            (p) => Prisma.sql`(${bookId}, ${p.page_number}, ${p.image_url ?? null}, ${p.text_content ?? null}, ${now}, ${now})`,
                        );
                        await tx.$executeRaw(Prisma.sql`
                            INSERT INTO book_pages (book_id, page_number, image_url, text_content, created_at, updated_at)
                            VALUES ${Prisma.join(tuples)}
                            ON DUPLICATE KEY UPDATE ${Prisma.join(assignments, ', ')}
                        `);
                    }
                }

                const agg = await tx.bookPage.aggregate({ where: { book_id: bookId }, _max: { page_number: true } });
                const nextCount = agg._max.page_number ?? 0;
                await tx.book.update({ where: { id: bookId }, data: { page_count: nextCount, updated_at: now } });
                return nextCount;
            },
            { timeout: 60_000, maxWait: 10_000 },
        );

        await this.invalidate();

        // Index only the pages whose text was actually supplied (best-effort). Pages sent
        // without `text_content` keep their MySQL text under the merge semantics above, so
        // their Postgres row is already correct — re-indexing them with null would wipe the
        // index entry that the DB still backs.
        const indexInputs: IndexPageInput[] = pages
            .filter((p) => p.text_content !== undefined)
            .map((p) => ({ page_number: p.page_number, text_content: p.text_content ?? null }));
        void this.searchIndex.indexPages(bookId, indexInputs).catch((err) => this.logger.warn(`indexPages(${bookId}) failed: ${(err as Error).message}`));

        return apiResponse(1, 'updated', 'ebooks.pages_replaced', {
            book_id: bookId,
            page_count: pageCount,
            upserted: pages.length,
        });
    }

    public async removePage(bookId: number, pageNumber: number) {
        await this.assertBook(bookId);

        const now = nowSec();
        const pageCount = await this.prisma.$transaction(async (tx) => {
            const del = await tx.bookPage.deleteMany({ where: { book_id: bookId, page_number: pageNumber } });
            if (del.count === 0) throw new NotFoundException('ebooks.page_not_found');

            const agg = await tx.bookPage.aggregate({ where: { book_id: bookId }, _max: { page_number: true } });
            const nextCount = agg._max.page_number ?? 0;
            await tx.book.update({ where: { id: bookId }, data: { page_count: nextCount, updated_at: now } });
            return nextCount;
        });

        await this.invalidate();
        void this.searchIndex
            .removePage(bookId, pageNumber)
            .catch((err) => this.logger.warn(`removePage(${bookId},${pageNumber}) failed: ${(err as Error).message}`));

        return apiResponse(1, 'deleted', 'ebooks.page_deleted', { book_id: bookId, page_number: pageNumber, page_count: pageCount });
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private async assertBook(bookId: number): Promise<void> {
        const book = await this.prisma.book.findUnique({ where: { id: bookId }, select: { id: true } });
        if (!book) throw new NotFoundException('ebooks.not_found');
    }

    private async invalidate(): Promise<void> {
        await this.cache.invalidate(EBOOKS_INVALIDATE_PATTERN);
        await this.cache.invalidate(EBOOKS_PUBLIC_INVALIDATE_PATTERN);
    }
}

function nowSec(): number {
    return Math.floor(Date.now() / 1000);
}

function chunk<T>(arr: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
        out.push(arr.slice(i, i + size));
    }
    return out;
}
