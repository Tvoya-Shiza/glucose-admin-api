import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { apiResponse } from '../../common/utils/api-response';
import { buildScopeWhere } from '../../common/scoping/scope.helper';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { ListBooksDto } from './dto/list-books.dto';
import { EBOOK_SCOPE_RULES } from './ebooks.scope';
import { EbooksCacheService } from './utils/ebooks-cache.service';
import { buildBookListCacheKey } from './utils/ebooks-cache';

/**
 * Phase 39/40 — ebook (Book) list + detail read surface.
 *
 * A book is a Book row + book_translations (kz title/description) + book_pages.
 * `title` is the kz BookTranslation.title. Facets (subject/publisher/grade) are FK
 * columns; subject/publisher labels are joined for the list/detail rows.
 *
 * Soft-deleted books (deleted_at != null) never appear in the LIST; detail still
 * resolves them (admin can inspect / re-publish).
 *
 * Scope: EBOOK_SCOPE_RULES is empty (all staff see all books); access is governed by
 * the runtime @RequirePermission('ebooks.view') grant. List reads via
 * EbooksCacheService.getOrSet at TTL=60s; the key embeds role + actor_id before the
 * filter hash. Invalidation lives in the mutations services.
 */

export interface BookSubjectRefDto {
    id: number;
    title_kz: string | null;
}

export interface BookPublisherRefDto {
    id: number;
    name: string;
}

export interface BookRowDto {
    id: number;
    title_kz: string | null;
    subject: BookSubjectRefDto | null;
    publisher: BookPublisherRefDto | null;
    grade: number | null;
    language: string;
    authors: string | null;
    year: number | null;
    cover_image: string | null;
    page_count: number;
    status: string;
    created_at: number;
}

export interface BookListResponse {
    rows: BookRowDto[];
    total: number;
    pageCount: number;
}

export function pickKzTitle(translations: Array<{ locale: string; title: string | null }> | undefined | null): string | null {
    const kz = (translations ?? []).find((t) => t.locale === 'kz')?.title?.trim() ?? '';
    return kz.length > 0 ? kz : null;
}

@Injectable()
export class BooksService {
    public static readonly DEFAULT_PAGE_SIZE = 50;
    public static readonly MAX_PAGE_SIZE = 200;
    public static readonly LIST_CACHE_TTL_SECONDS = 60;

    constructor(
        private readonly prisma: PrismaService,
        private readonly cache: EbooksCacheService,
    ) {}

    public async list(actor: ScopeActor, query: ListBooksDto): Promise<BookListResponse> {
        const cacheKey = buildBookListCacheKey(actor.role_name, actor.id, query as Record<string, unknown>);
        return this.cache.getOrSet<BookListResponse>(cacheKey, () => this.runListQuery(actor, query), BooksService.LIST_CACHE_TTL_SECONDS);
    }

    private async runListQuery(actor: ScopeActor, query: ListBooksDto): Promise<BookListResponse> {
        const page = Math.max(1, query.page ?? 1);
        const page_size = Math.min(BooksService.MAX_PAGE_SIZE, Math.max(1, query.page_size ?? BooksService.DEFAULT_PAGE_SIZE));

        const filterWhere: any = { deleted_at: null };
        if (query.status) filterWhere.status = query.status;
        if (typeof query.subject_id === 'number') filterWhere.subject_id = query.subject_id;
        if (typeof query.publisher_id === 'number') filterWhere.publisher_id = query.publisher_id;
        if (typeof query.grade === 'number') filterWhere.grade = query.grade;
        if (query.q && query.q.trim().length > 0) {
            // kz title contains; MySQL collation makes this case-insensitive.
            filterWhere.translations = { some: { locale: 'kz', title: { contains: query.q.trim() } } };
        }

        const scopeWhere = buildScopeWhere(actor, EBOOK_SCOPE_RULES);
        const where: any = { ...filterWhere, ...(scopeWhere as object) };

        const skip = (page - 1) * page_size;
        const [total, rowsRaw] = await this.prisma.$transaction([
            this.prisma.book.count({ where }),
            this.prisma.book.findMany({
                where,
                orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
                take: page_size,
                skip,
                select: {
                    id: true,
                    grade: true,
                    language: true,
                    authors: true,
                    year: true,
                    cover_image: true,
                    page_count: true,
                    status: true,
                    created_at: true,
                    translations: { select: { locale: true, title: true } },
                    subject: { select: { id: true, translations: { select: { locale: true, title: true } } } },
                    publisher: { select: { id: true, name: true } },
                },
            }),
        ]);

        const rows: BookRowDto[] = (rowsRaw as any[]).map((r) => this.mapRow(r));
        return { rows, total, pageCount: Math.max(1, Math.ceil(total / page_size)) };
    }

    private mapRow(r: any): BookRowDto {
        return {
            id: Number(r.id),
            title_kz: pickKzTitle(r.translations),
            subject: r.subject ? { id: Number(r.subject.id), title_kz: pickKzTitle(r.subject.translations) } : null,
            publisher: r.publisher ? { id: Number(r.publisher.id), name: r.publisher.name } : null,
            grade: r.grade == null ? null : Number(r.grade),
            language: r.language,
            authors: r.authors,
            year: r.year == null ? null : Number(r.year),
            cover_image: r.cover_image ?? null,
            page_count: Number(r.page_count ?? 0),
            status: r.status,
            created_at: Number(r.created_at),
        };
    }

    /** GET /admin-api/v1/admin/ebooks/:id — full detail incl. kz translation. */
    public async detail(actor: ScopeActor, id: number) {
        void actor; // access governed by @Roles + @RequirePermission('ebooks.view')
        const detail = await this.readDetail(id);
        return apiResponse(1, 'ok', 'ebooks.detail', detail);
    }

    /** Shared full-detail projection (also re-read by the mutations service after writes). */
    public async readDetail(id: number) {
        const r: any = await this.prisma.book.findUnique({
            where: { id },
            select: {
                id: true,
                subject_id: true,
                publisher_id: true,
                grade: true,
                language: true,
                year: true,
                cover_image: true,
                source_file_url: true,
                page_count: true,
                status: true,
                created_at: true,
                updated_at: true,
                deleted_at: true,
                translations: { select: { locale: true, title: true, description: true } },
                subject: { select: { id: true, translations: { select: { locale: true, title: true } } } },
                publisher: { select: { id: true, name: true } },
            },
        });
        if (!r) throw new NotFoundException('ebooks.not_found');

        const kz = (r.translations ?? []).find((t: any) => t.locale === 'kz');
        return {
            id: Number(r.id),
            title_kz: pickKzTitle(r.translations),
            translations: ((r.translations ?? []) as any[])
                .filter((t) => t.locale === 'kz')
                .map((t) => ({ locale: 'kz' as const, title: t.title, description: t.description ?? null })),
            description_kz: kz?.description ?? null,
            subject: r.subject ? { id: Number(r.subject.id), title_kz: pickKzTitle(r.subject.translations) } : null,
            publisher: r.publisher ? { id: Number(r.publisher.id), name: r.publisher.name } : null,
            grade: r.grade == null ? null : Number(r.grade),
            language: r.language,
            authors: r.authors,
            year: r.year == null ? null : Number(r.year),
            cover_image: r.cover_image ?? null,
            source_file_url: r.source_file_url ?? null,
            page_count: Number(r.page_count ?? 0),
            status: r.status,
            created_at: Number(r.created_at),
            updated_at: r.updated_at == null ? null : Number(r.updated_at),
            deleted_at: r.deleted_at == null ? null : Number(r.deleted_at),
        };
    }
}
