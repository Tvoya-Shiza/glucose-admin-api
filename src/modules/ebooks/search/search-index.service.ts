import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Phase 39/40 — Postgres search read-model writer for `book_page_index`.
 *
 * Source of truth is MySQL (book_pages). This service maintains a REBUILDABLE
 * Postgres projection used by the full-text search endpoints. It is BEST-EFFORT:
 * when SEARCH_DATABASE_URL is unset, or the pool errors, every method logs a warning
 * and no-ops. A mutation MUST NEVER fail because Postgres is down — callers invoke
 * these methods fire-and-forget AFTER the MySQL transaction commits.
 *
 * The `tsv` column is maintained by a DB trigger (BEFORE INSERT OR UPDATE OF content),
 * so we never compute tsvector here — we only ensure `content` is in every UPDATE set.
 *
 * Pool is created LAZILY on first use and torn down on module destroy.
 */

export interface BookIndexMeta {
    book_id: number;
    book_title: string | null;
    subject_id: number | null;
    publisher_id: number | null;
    grade: number | null;
    language: string | null;
}

export interface IndexPageInput {
    page_number: number;
    text_content: string | null;
}

export interface ReindexResult {
    ok: boolean;
    indexed: number;
    reason?: string;
}

/** Columns in the parameterized INSERT, in order. */
const INSERT_COLUMNS = 11;
/** Max rows per INSERT to stay well under Postgres' 65535-parameter cap. */
const UPSERT_CHUNK = 500;

@Injectable()
export class EbooksSearchIndexService implements OnModuleDestroy {
    private readonly logger = new Logger(EbooksSearchIndexService.name);
    private pool: Pool | null = null;
    private disabled = false;

    constructor(
        private readonly config: ConfigService,
        private readonly prisma: PrismaService,
    ) {}

    async onModuleDestroy(): Promise<void> {
        if (this.pool) {
            try {
                await this.pool.end();
            } catch {
                /* ignore teardown errors */
            }
            this.pool = null;
        }
    }

    /**
     * Lazy pool accessor. Returns null (and disables further attempts) when
     * SEARCH_DATABASE_URL is unset or the pool cannot be constructed.
     */
    private getPool(): Pool | null {
        if (this.disabled) return null;
        if (this.pool) return this.pool;

        const url = this.config.get<string>('searchDatabaseUrl');
        if (!url) {
            this.logger.warn('SEARCH_DATABASE_URL unset — book search indexing disabled (no-op).');
            this.disabled = true;
            return null;
        }
        try {
            const pool = new Pool({
                connectionString: url,
                max: 4,
                connectionTimeoutMillis: 5_000,
                idleTimeoutMillis: 30_000,
            });
            // Idle-client errors must not crash the process — swallow + log.
            pool.on('error', (err) => this.logger.warn(`pg idle-client error: ${err.message}`));
            this.pool = pool;
            return pool;
        } catch (err) {
            this.logger.warn(`failed to init pg pool: ${(err as Error).message} — indexing disabled`);
            this.disabled = true;
            return null;
        }
    }

    /**
     * Upsert a batch of pages for one book. INSERT ... ON CONFLICT (book_id,page_number)
     * DO UPDATE. content_hash = sha256(content); source_version bumps on update; the DB
     * trigger recomputes tsv because `content` is always in the update set.
     */
    public async upsertPages(meta: BookIndexMeta, pages: IndexPageInput[]): Promise<void> {
        if (pages.length === 0) return;
        const pool = this.getPool();
        if (!pool) return;

        let client: PoolClient | undefined;
        try {
            client = await pool.connect();
            for (const group of chunk(pages, UPSERT_CHUNK)) {
                await this.upsertChunk(client, meta, group);
            }
        } catch (err) {
            this.logger.warn(`upsertPages(book ${meta.book_id}): ${(err as Error).message} — index left stale`);
        } finally {
            client?.release();
        }
    }

    private async upsertChunk(client: PoolClient, meta: BookIndexMeta, pages: IndexPageInput[]): Promise<void> {
        const tuples: string[] = [];
        const params: unknown[] = [];
        pages.forEach((p, i) => {
            const base = i * INSERT_COLUMNS;
            tuples.push(
                `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10},$${base + 11})`,
            );
            const content = p.text_content ?? '';
            params.push(
                meta.book_id,
                p.page_number,
                meta.book_title,
                meta.subject_id,
                meta.publisher_id,
                meta.grade,
                meta.language,
                content,
                // Phase 42 — Kazakh stems, so «кітап» matches «кітаптарында».
                // MUST use the same stemmer as the query side (glucose-api).
                kazakhStemText(content),
                sha256(content),
                1,
            );
        });

        const sql = `
            INSERT INTO book_page_index
                (book_id, page_number, book_title, subject_id, publisher_id, grade, language, content, content_kk, content_hash, source_version)
            VALUES ${tuples.join(',')}
            ON CONFLICT (book_id, page_number) DO UPDATE SET
                book_title     = EXCLUDED.book_title,
                subject_id     = EXCLUDED.subject_id,
                publisher_id   = EXCLUDED.publisher_id,
                grade          = EXCLUDED.grade,
                language       = EXCLUDED.language,
                content        = EXCLUDED.content,
                content_kk     = EXCLUDED.content_kk,
                content_hash   = EXCLUDED.content_hash,
                source_version = book_page_index.source_version + 1,
                indexed_at     = now()
        `;
        await client.query(sql, params);
    }

    /** Delete every index row for a book (called on soft-delete / hard rebuild). */
    public async removeBook(bookId: number): Promise<void> {
        await this.exec('removeBook', bookId, 'DELETE FROM book_page_index WHERE book_id = $1', [bookId]);
    }

    /** Delete a single page's index row. */
    public async removePage(bookId: number, pageNumber: number): Promise<void> {
        await this.exec('removePage', bookId, 'DELETE FROM book_page_index WHERE book_id = $1 AND page_number = $2', [bookId, pageNumber]);
    }

    private async exec(label: string, bookId: number, sql: string, params: unknown[]): Promise<void> {
        const pool = this.getPool();
        if (!pool) return;
        try {
            await pool.query(sql, params);
        } catch (err) {
            this.logger.warn(`${label}(book ${bookId}): ${(err as Error).message}`);
        }
    }

    /**
     * Index a set of changed pages whose content the caller already holds (the pages PUT
     * has replace semantics, so the request body is authoritative). Loads the denormalized
     * book meta once, then upserts. Best-effort.
     */
    public async indexPages(bookId: number, pages: IndexPageInput[]): Promise<void> {
        if (pages.length === 0) return;
        if (!this.getPool()) return;
        try {
            const meta = await this.loadMeta(bookId);
            if (!meta) return;
            await this.upsertPages(meta, pages);
        } catch (err) {
            this.logger.warn(`indexPages(book ${bookId}): ${(err as Error).message}`);
        }
    }

    /**
     * Full rebuild for one book: read all pages from MySQL, then in a single Postgres
     * transaction DELETE the book's rows and re-insert the current set. Returns a
     * summary (never throws — best-effort).
     */
    public async reindexBook(bookId: number): Promise<ReindexResult> {
        const pool = this.getPool();
        if (!pool) return { ok: false, indexed: 0, reason: 'search_index_disabled' };

        let client: PoolClient | undefined;
        try {
            const meta = await this.loadMeta(bookId);
            const rows = await this.prisma.bookPage.findMany({
                where: { book_id: bookId },
                select: { page_number: true, text_content: true },
                orderBy: { page_number: 'asc' },
            });

            client = await pool.connect();
            try {
                await client.query('BEGIN');
                await client.query('DELETE FROM book_page_index WHERE book_id = $1', [bookId]);
                if (meta && rows.length > 0) {
                    const pages: IndexPageInput[] = rows.map((r) => ({ page_number: r.page_number, text_content: r.text_content }));
                    for (const group of chunk(pages, UPSERT_CHUNK)) {
                        await this.upsertChunk(client, meta, group);
                    }
                }
                await client.query('COMMIT');
            } catch (err) {
                await client.query('ROLLBACK').catch(() => undefined);
                throw err;
            }
            return { ok: true, indexed: meta ? rows.length : 0 };
        } catch (err) {
            this.logger.warn(`reindexBook(book ${bookId}): ${(err as Error).message}`);
            return { ok: false, indexed: 0, reason: (err as Error).message };
        } finally {
            client?.release();
        }
    }

    /** Build the denormalized index meta (title_kz + facets) for a book from MySQL. */
    private async loadMeta(bookId: number): Promise<BookIndexMeta | null> {
        const book: any = await this.prisma.book.findUnique({
            where: { id: bookId },
            select: {
                id: true,
                subject_id: true,
                publisher_id: true,
                grade: true,
                language: true,
                translations: { where: { locale: 'kz' }, select: { title: true }, take: 1 },
            },
        });
        if (!book) return null;
        return {
            book_id: Number(book.id),
            book_title: book.translations?.[0]?.title ?? null,
            subject_id: book.subject_id == null ? null : Number(book.subject_id),
            publisher_id: book.publisher_id == null ? null : Number(book.publisher_id),
            grade: book.grade == null ? null : Number(book.grade),
            language: book.language ?? null,
        };
    }
}

function sha256(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
}

function chunk<T>(arr: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
        out.push(arr.slice(i, i + size));
    }
    return out;
}
