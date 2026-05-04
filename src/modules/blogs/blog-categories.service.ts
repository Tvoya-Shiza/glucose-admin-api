import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpsertBlogCategoryDto } from './dto/upsert-blog-category.dto';
import { BlogsCacheService } from './utils/blogs-cache.service';
import { BLOGS_INVALIDATE_PATTERN } from './utils/blogs-cache';

/**
 * BLG-02 — BlogCategory CRUD (Plan 04).
 *
 * Schema-truth (Plan 01 lock):
 *   - BlogCategory: id ONLY (NO slug column). Translations table holds title.
 *   - BlogCategoryTranslation: per-locale title only (no description).
 *   - NO @@unique on translations — find-then-update.
 *
 * Delete pre-check: refuses if any Blog.category_id === id (returns 400
 * 'blogs.category_in_use'). The FK in schema is onDelete: Cascade on the Blog side
 * as a backstop, but a friendly 400 with copy is better UX than a Prisma FK error
 * surfaced as 500.
 *
 * Returns up to 500 rows from list (no pagination — categories surface is small).
 */
export interface BlogCategoryListRow {
    id: number;
    title_ru: string | null;
    title_kz: string | null;
}

export interface BlogCategoryDetail extends BlogCategoryListRow {
    /** Total blogs using this category — surfaced for delete-gate UX. */
    blog_count: number;
}

@Injectable()
export class BlogCategoriesService {
    private readonly logger = new Logger(BlogCategoriesService.name);

    public static readonly LIST_CAP = 500;

    constructor(
        private readonly prisma: PrismaService,
        private readonly cache: BlogsCacheService,
    ) {}

    public async list(): Promise<{ rows: BlogCategoryListRow[] }> {
        const rows: any[] = await this.prisma.blogCategory.findMany({
            orderBy: { id: 'desc' },
            take: BlogCategoriesService.LIST_CAP,
            select: {
                id: true,
                translations: { select: { locale: true, title: true } },
            },
        });
        const out: BlogCategoryListRow[] = rows.map((r) => {
            const ru = (r.translations ?? []).find((t: any) => t.locale === 'ru');
            const kz = (r.translations ?? []).find((t: any) => t.locale === 'kz');
            return {
                id: Number(r.id),
                title_ru: ru?.title ?? null,
                title_kz: kz?.title ?? null,
            };
        });
        return { rows: out };
    }

    public async getDetail(id: number): Promise<BlogCategoryDetail> {
        const row: any = await this.prisma.blogCategory.findFirst({
            where: { id },
            select: {
                id: true,
                translations: { select: { locale: true, title: true } },
                _count: { select: { blogs: true } },
            },
        });
        if (!row) throw new NotFoundException('blogs.category_not_found');
        const ru = (row.translations ?? []).find((t: any) => t.locale === 'ru');
        const kz = (row.translations ?? []).find((t: any) => t.locale === 'kz');
        return {
            id: Number(row.id),
            title_ru: ru?.title ?? null,
            title_kz: kz?.title ?? null,
            blog_count: row._count?.blogs ?? 0,
        };
    }

    public async create(dto: UpsertBlogCategoryDto): Promise<BlogCategoryDetail> {
        const created: any = await this.prisma.$transaction(async (tx) => {
            const c: any = await tx.blogCategory.create({
                data: {},
                select: { id: true },
            });
            if (dto.title_ru !== undefined && dto.title_ru !== null && dto.title_ru !== '') {
                await tx.blogCategoryTranslation.create({
                    data: { blog_category_id: c.id, locale: 'ru', title: dto.title_ru },
                });
            }
            if (dto.title_kz !== undefined && dto.title_kz !== null && dto.title_kz !== '') {
                await tx.blogCategoryTranslation.create({
                    data: { blog_category_id: c.id, locale: 'kz', title: dto.title_kz },
                });
            }
            return c;
        });

        await this.cache.invalidate(BLOGS_INVALIDATE_PATTERN);
        return this.getDetail(Number(created.id));
    }

    public async update(id: number, dto: UpsertBlogCategoryDto): Promise<BlogCategoryDetail> {
        const existing: any = await this.prisma.blogCategory.findFirst({
            where: { id },
            select: { id: true },
        });
        if (!existing) throw new NotFoundException('blogs.category_not_found');

        await this.prisma.$transaction(async (tx) => {
            if (dto.title_ru !== undefined) {
                await this.upsertCategoryTranslation(tx, id, 'ru', dto.title_ru);
            }
            if (dto.title_kz !== undefined) {
                await this.upsertCategoryTranslation(tx, id, 'kz', dto.title_kz);
            }
        });

        await this.cache.invalidate(BLOGS_INVALIDATE_PATTERN);
        return this.getDetail(id);
    }

    public async hardDelete(id: number): Promise<{ id: number; deleted: true }> {
        const existing: any = await this.prisma.blogCategory.findFirst({
            where: { id },
            select: { id: true },
        });
        if (!existing) throw new NotFoundException('blogs.category_not_found');

        const usage = await this.prisma.blog.count({ where: { category_id: id } });
        if (usage > 0) {
            throw new BadRequestException('blogs.category_in_use');
        }

        // Translations cascade via onDelete: Cascade.
        await this.prisma.blogCategory.delete({ where: { id } });

        await this.cache.invalidate(BLOGS_INVALIDATE_PATTERN);
        return { id, deleted: true };
    }

    private async upsertCategoryTranslation(
        tx: any,
        blog_category_id: number,
        locale: 'ru' | 'kz',
        title: string | null | undefined,
    ): Promise<void> {
        const row: any = await tx.blogCategoryTranslation.findFirst({
            where: { blog_category_id, locale },
            select: { id: true },
            orderBy: { id: 'asc' },
        });
        if (row) {
            if (title === null || title === undefined || title === '') {
                // Empty value clears the translation row.
                await tx.blogCategoryTranslation.delete({ where: { id: row.id } });
            } else {
                await tx.blogCategoryTranslation.update({
                    where: { id: row.id },
                    data: { title },
                });
            }
        } else if (title !== null && title !== undefined && title !== '') {
            await tx.blogCategoryTranslation.create({
                data: { blog_category_id, locale, title },
            });
        }
    }
}
