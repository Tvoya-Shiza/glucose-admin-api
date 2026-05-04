import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * BAN-01 — banner detail (Plan 03).
 *
 * Mirrors StoriesDetailService minus the `icon` column (Advertisement schema has
 * only `image` + `video`).
 *
 * Admin-only (controller @Roles('admin') + BANNER_SCOPE_RULES default-deny). Returns
 * full Advertisement + translations[] + category (with translations) + author (full_name).
 *
 * Schema-truth: no soft-delete column. 404 = row genuinely absent.
 */
export interface BannerTranslationDetail {
    locale: 'ru' | 'kz';
    title: string;
    description: string;
    content: string;
}

export interface BannerDetail {
    id: number;
    slug: string;
    image: string | null;
    video: string | null;
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
    translations: BannerTranslationDetail[];
    category: {
        id: number;
        slug: string;
        title_ru: string | null;
        title_kz: string | null;
    } | null;
    author: { id: number; full_name: string | null } | null;
}

@Injectable()
export class BannersDetailService {
    private readonly logger = new Logger(BannersDetailService.name);

    constructor(private readonly prisma: PrismaService) {}

    public async getDetail(id: number): Promise<BannerDetail> {
        const row: any = await this.prisma.advertisement.findFirst({
            where: { id },
            select: {
                id: true,
                slug: true,
                image: true,
                video: true,
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
                        slug: true,
                        translations: { select: { locale: true, title: true } },
                    },
                },
                author: { select: { id: true, full_name: true } },
            },
        });

        if (!row) {
            throw new NotFoundException('banners.not_found');
        }

        const translations: BannerTranslationDetail[] = (row.translations ?? [])
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
            video: row.video ?? null,
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
                      slug: row.category.slug,
                      title_ru,
                      title_kz,
                  }
                : null,
            author: row.author
                ? { id: Number(row.author.id), full_name: row.author.full_name ?? null }
                : null,
        };
    }
}
