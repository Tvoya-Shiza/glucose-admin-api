import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpsertBannerCategoryDto } from './dto/upsert-banner-category.dto';
import { BannersCacheService } from './utils/banners-cache.service';
import { BANNERS_INVALIDATE_PATTERN } from './utils/banners-cache';

/**
 * BAN-02 — AdvertisementCategory CRUD (Plan 03).
 *
 * Mirrors StoryCategoriesService (Plan 02). Targets `prisma.advertisementCategory.*`
 * and `prisma.advertisementCategoryTranslation.*`. The relation to count (per delete-gate
 * UX) is `advertisements` (verified against schema line 1259).
 *
 * Schema-truth (Plan 01 lock):
 *   - AdvertisementCategory: id + slug (no parent_id, no description, no timestamps).
 *   - AdvertisementCategoryTranslation: per-locale title only (no description).
 *   - NO @@unique on translations — find-then-update.
 *
 * Delete pre-check: refuses if any Advertisement.category_id === id (returns 400
 * 'banners.category_in_use'). The FK in schema is `onDelete: Cascade` on the
 * Advertisement side, but a friendly 400 with copy is better UX than a Prisma FK
 * error surfaced as 500.
 *
 * Returns up to 500 rows from list (no pagination — categories surface is small;
 * Plan 03 keeps it bounded for frontend consumption).
 */
export interface BannerCategoryListRow {
    id: number;
    slug: string;
    title_ru: string | null;
    title_kz: string | null;
}

export interface BannerCategoryDetail extends BannerCategoryListRow {
    /** Total banners using this category — surfaced for delete-gate UX. */
    banner_count: number;
}

@Injectable()
export class BannerCategoriesService {
    private readonly logger = new Logger(BannerCategoriesService.name);

    public static readonly LIST_CAP = 500;

    constructor(
        private readonly prisma: PrismaService,
        private readonly cache: BannersCacheService,
    ) {}

    public async list(): Promise<{ rows: BannerCategoryListRow[] }> {
        const rows: any[] = await this.prisma.advertisementCategory.findMany({
            orderBy: { id: 'desc' },
            take: BannerCategoriesService.LIST_CAP,
            select: {
                id: true,
                slug: true,
                translations: { select: { locale: true, title: true } },
            },
        });
        const out: BannerCategoryListRow[] = rows.map((r) => {
            const ru = (r.translations ?? []).find((t: any) => t.locale === 'ru');
            const kz = (r.translations ?? []).find((t: any) => t.locale === 'kz');
            return {
                id: Number(r.id),
                slug: r.slug,
                title_ru: ru?.title ?? null,
                title_kz: kz?.title ?? null,
            };
        });
        return { rows: out };
    }

    public async getDetail(id: number): Promise<BannerCategoryDetail> {
        const row: any = await this.prisma.advertisementCategory.findFirst({
            where: { id },
            select: {
                id: true,
                slug: true,
                translations: { select: { locale: true, title: true } },
                _count: { select: { advertisements: true } },
            },
        });
        if (!row) throw new NotFoundException('banners.category_not_found');
        const ru = (row.translations ?? []).find((t: any) => t.locale === 'ru');
        const kz = (row.translations ?? []).find((t: any) => t.locale === 'kz');
        return {
            id: Number(row.id),
            slug: row.slug,
            title_ru: ru?.title ?? null,
            title_kz: kz?.title ?? null,
            banner_count: row._count?.advertisements ?? 0,
        };
    }

    public async create(dto: UpsertBannerCategoryDto): Promise<BannerCategoryDetail> {
        if (!dto.slug) throw new BadRequestException('banners.category_slug_required');

        const created: any = await this.prisma.$transaction(async (tx) => {
            const c: any = await tx.advertisementCategory.create({
                data: { slug: dto.slug! },
                select: { id: true },
            });
            if (dto.title_ru !== undefined && dto.title_ru !== null) {
                await tx.advertisementCategoryTranslation.create({
                    data: { advertisement_category_id: c.id, locale: 'ru', title: dto.title_ru },
                });
            }
            if (dto.title_kz !== undefined && dto.title_kz !== null) {
                await tx.advertisementCategoryTranslation.create({
                    data: { advertisement_category_id: c.id, locale: 'kz', title: dto.title_kz },
                });
            }
            return c;
        });

        await this.cache.invalidate(BANNERS_INVALIDATE_PATTERN);
        return this.getDetail(Number(created.id));
    }

    public async update(id: number, dto: UpsertBannerCategoryDto): Promise<BannerCategoryDetail> {
        const existing: any = await this.prisma.advertisementCategory.findFirst({
            where: { id },
            select: { id: true },
        });
        if (!existing) throw new NotFoundException('banners.category_not_found');

        await this.prisma.$transaction(async (tx) => {
            if (typeof dto.slug === 'string') {
                await tx.advertisementCategory.update({
                    where: { id },
                    data: { slug: dto.slug },
                });
            }
            if (dto.title_ru !== undefined) {
                await this.upsertCategoryTranslation(tx, id, 'ru', dto.title_ru);
            }
            if (dto.title_kz !== undefined) {
                await this.upsertCategoryTranslation(tx, id, 'kz', dto.title_kz);
            }
        });

        await this.cache.invalidate(BANNERS_INVALIDATE_PATTERN);
        return this.getDetail(id);
    }

    public async hardDelete(id: number): Promise<{ id: number; deleted: true }> {
        const existing: any = await this.prisma.advertisementCategory.findFirst({
            where: { id },
            select: { id: true },
        });
        if (!existing) throw new NotFoundException('banners.category_not_found');

        const usage = await this.prisma.advertisement.count({ where: { category_id: id } });
        if (usage > 0) {
            throw new BadRequestException('banners.category_in_use');
        }

        // Translations cascade via onDelete: Cascade.
        await this.prisma.advertisementCategory.delete({ where: { id } });

        await this.cache.invalidate(BANNERS_INVALIDATE_PATTERN);
        return { id, deleted: true };
    }

    private async upsertCategoryTranslation(
        tx: any,
        advertisement_category_id: number,
        locale: 'ru' | 'kz',
        title: string | null | undefined,
    ): Promise<void> {
        const row: any = await tx.advertisementCategoryTranslation.findFirst({
            where: { advertisement_category_id, locale },
            select: { id: true },
            orderBy: { id: 'asc' },
        });
        if (row) {
            if (title === null || title === undefined || title === '') {
                // Empty value clears the translation row.
                await tx.advertisementCategoryTranslation.delete({ where: { id: row.id } });
            } else {
                await tx.advertisementCategoryTranslation.update({
                    where: { id: row.id },
                    data: { title },
                });
            }
        } else if (title !== null && title !== undefined && title !== '') {
            await tx.advertisementCategoryTranslation.create({
                data: { advertisement_category_id, locale, title },
            });
        }
    }
}
