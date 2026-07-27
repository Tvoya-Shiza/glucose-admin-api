import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { apiResponse } from '../../common/utils/api-response';
import { EbooksCacheService } from './utils/ebooks-cache.service';
import { EBOOKS_INVALIDATE_PATTERN, EBOOKS_PUBLIC_INVALIDATE_PATTERN } from './utils/ebooks-cache';
import { ListPublishersDto } from './dto/list-publishers.dto';
import { UpsertPublisherDto } from './dto/upsert-publisher.dto';

/**
 * Phase 39/40 — Publisher CRUD (name-only reference entity).
 *
 * Books reference publishers via Book.publisher_id (FK `books_publisher_id_fkey`,
 * onDelete: SetNull). Because the FK is SET NULL, deleting a publisher is SAFE — its
 * books simply lose the link (publisher_id → NULL) rather than being orphaned or
 * blocking the delete. We surface how many books were unlinked so the caller can
 * reassign them.
 *
 * Publisher name changes ripple into the cached book-list rows (which embed
 * {publisher:{id,name}}), so every mutation nukes the ebooks cache namespaces.
 */
@Injectable()
export class PublishersService {
    public static readonly DEFAULT_PAGE_SIZE = 50;
    public static readonly MAX_PAGE_SIZE = 200;

    constructor(
        private readonly prisma: PrismaService,
        private readonly cache: EbooksCacheService,
    ) {}

    public async list(query: ListPublishersDto) {
        const page = Math.max(1, query.page ?? 1);
        const page_size = Math.min(PublishersService.MAX_PAGE_SIZE, Math.max(1, query.page_size ?? PublishersService.DEFAULT_PAGE_SIZE));

        const where: any = {};
        if (query.q && query.q.trim().length > 0) {
            where.name = { contains: query.q.trim() };
        }

        const skip = (page - 1) * page_size;
        const [total, rowsRaw] = await this.prisma.$transaction([
            this.prisma.publisher.count({ where }),
            this.prisma.publisher.findMany({
                where,
                orderBy: [{ name: 'asc' }, { id: 'asc' }],
                take: page_size,
                skip,
                select: {
                    id: true,
                    name: true,
                    created_at: true,
                    updated_at: true,
                    _count: { select: { books: true } },
                },
            }),
        ]);

        const rows = (rowsRaw as any[]).map((r) => ({
            id: Number(r.id),
            name: r.name,
            book_count: Number(r._count?.books ?? 0),
            created_at: Number(r.created_at),
            updated_at: r.updated_at == null ? null : Number(r.updated_at),
        }));

        return { rows, total, pageCount: Math.max(1, Math.ceil(total / page_size)) };
    }

    public async create(dto: UpsertPublisherDto) {
        const name = dto.name.trim();
        await this.assertNameUnique(name, null);

        const created = await this.prisma.publisher.create({
            data: { name, created_at: nowSec() },
            select: { id: true, name: true, created_at: true },
        });

        await this.invalidate();
        return apiResponse(1, 'created', 'publishers.created', {
            id: Number(created.id),
            name: created.name,
            created_at: Number(created.created_at),
        });
    }

    public async update(id: number, dto: UpsertPublisherDto) {
        await this.assertExists(id);
        const name = dto.name.trim();
        await this.assertNameUnique(name, id);

        const updated = await this.prisma.publisher.update({
            where: { id },
            data: { name, updated_at: nowSec() },
            select: { id: true, name: true, updated_at: true },
        });

        await this.invalidate();
        return apiResponse(1, 'updated', 'publishers.updated', {
            id: Number(updated.id),
            name: updated.name,
            updated_at: updated.updated_at == null ? null : Number(updated.updated_at),
        });
    }

    public async remove(id: number) {
        await this.assertExists(id);

        // FK is SET NULL — count the books that will lose their publisher link so the
        // caller can reassign them, then delete. Prisma applies the referential action.
        const unlinked = await this.prisma.book.count({ where: { publisher_id: id } });
        await this.prisma.publisher.delete({ where: { id } });

        await this.invalidate();
        return apiResponse(1, 'deleted', 'publishers.deleted', { id, deleted: true, unlinked_books: unlinked });
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private async assertExists(id: number): Promise<void> {
        const row = await this.prisma.publisher.findUnique({ where: { id }, select: { id: true } });
        if (!row) throw new NotFoundException('publishers.not_found');
    }

    private async assertNameUnique(name: string, exceptId: number | null): Promise<void> {
        const existing = await this.prisma.publisher.findFirst({
            where: { name, ...(exceptId != null ? { id: { not: exceptId } } : {}) },
            select: { id: true },
        });
        if (existing) throw new ConflictException('publishers.name_taken');
    }

    private async invalidate(): Promise<void> {
        await this.cache.invalidate(EBOOKS_INVALIDATE_PATTERN);
        await this.cache.invalidate(EBOOKS_PUBLIC_INVALIDATE_PATTERN);
    }
}

function nowSec(): number {
    return Math.floor(Date.now() / 1000);
}
