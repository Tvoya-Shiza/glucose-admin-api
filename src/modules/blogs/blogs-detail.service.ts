import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * BLG-01 — blog detail (Plan 04).
 *
 * Admin-only (controller @Roles('admin') + BLOG_SCOPE_RULES default-deny). Returns
 * full Blog + translations[] + category (with translations) + author (full_name).
 *
 * Schema-truth: no soft-delete column. 404 = row genuinely absent.
 *
 * Note: BlogCategory has NO `slug` column on the schema (Plan 01 schema-truth lock).
 * The category sub-shape on BlogDetail therefore omits slug, diverging from
 * StoryDetail / BannerDetail.
 */
export interface BlogTranslationDetail {
    locale: 'ru' | 'kz';
    title: string;
    description: string;
    /** Tiptap HTML — already sanitized server-side at write-time (T-07-04-02). */
    content: string;
}

export interface BlogDetail {
    id: number;
    slug: string;
    image: string | null;
    status: 'pending' | 'publish';
    category_id: number;
    author_id: number;
    visit_count: number;
    enable_comment: boolean;
    link_type: string | null;
    page_type: string | null;
    link: string | null;
    created_at: number;
    updated_at: number;
    translations: BlogTranslationDetail[];
    category: {
        id: number;
        title_ru: string | null;
        title_kz: string | null;
    } | null;
    author: { id: number; full_name: string | null; role_name: string | null } | null;
}

@Injectable()
export class BlogsDetailService {
    private readonly logger = new Logger(BlogsDetailService.name);

    constructor(private readonly prisma: PrismaService) {}

    public async getDetail(id: number): Promise<BlogDetail> {
        const row: any = await this.prisma.blog.findFirst({
            where: { id },
            select: {
                id: true,
                slug: true,
                image: true,
                status: true,
                category_id: true,
                author_id: true,
                visit_count: true,
                enable_comment: true,
                link_type: true,
                page_type: true,
                link: true,
                created_at: true,
                updated_at: true,
                translations: {
                    select: { locale: true, title: true, description: true, content: true },
                },
                category: {
                    select: {
                        id: true,
                        translations: { select: { locale: true, title: true } },
                    },
                },
                author: { select: { id: true, full_name: true, role_name: true } },
            },
        });

        if (!row) {
            throw new NotFoundException('blogs.not_found');
        }

        const translations: BlogTranslationDetail[] = (row.translations ?? [])
            .filter((t: any) => t.locale === 'ru' || t.locale === 'kz')
            .map((t: any) => ({
                locale: t.locale as 'ru' | 'kz',
                title: t.title ?? '',
                description: t.description ?? '',
                content: t.content ?? '',
            }));

        let title_ru: string | null = null;
        let title_kz: string | null = null;
        if (row.category && Array.isArray(row.category.translations)) {
            for (const ct of row.category.translations) {
                if (ct.locale === 'ru' && (ct.title ?? '').length > 0) title_ru = ct.title;
                if (ct.locale === 'kz' && (ct.title ?? '').length > 0) title_kz = ct.title;
            }
        }

        return {
            id: Number(row.id),
            slug: row.slug,
            image: row.image ?? null,
            status: row.status as 'pending' | 'publish',
            category_id: Number(row.category_id),
            author_id: Number(row.author_id),
            visit_count: Number(row.visit_count ?? 0),
            enable_comment: !!row.enable_comment,
            link_type: row.link_type ?? null,
            page_type: row.page_type ?? null,
            link: row.link ?? null,
            created_at: Number(row.created_at),
            updated_at: Number(row.updated_at ?? row.created_at),
            translations,
            category: row.category
                ? {
                      id: Number(row.category.id),
                      title_ru,
                      title_kz,
                  }
                : null,
            author: row.author
                ? {
                      id: Number(row.author.id),
                      full_name: row.author.full_name ?? null,
                      role_name: row.author.role_name ?? null,
                  }
                : null,
        };
    }
}
