import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { UpsertBannerDto } from './dto/upsert-banner.dto';
import { BannersDetailService, type BannerDetail } from './banners-detail.service';
import { BannersCacheService } from './utils/banners-cache.service';
import { BANNERS_INVALIDATE_PATTERN, BANNERS_PUBLIC_INVALIDATE_PATTERN } from './utils/banners-cache';

/**
 * BAN-01 — banner create / update / hard-delete (Plan 03 Task 1).
 *
 * Mirrors StoriesMutationsService (Plan 02) MINUS the `icon` field — Advertisement
 * schema has only `image` + `video`. Targets `prisma.advertisement.*` and
 * `prisma.advertisementTranslation.*`.
 *
 * Decisions baked in:
 *
 *   - HARD delete (NOT soft): Advertisement has NO `deleted_at` column. DELETE is
 *     a row removal; `AdvertisementTranslation.advertisement_id` FK is
 *     `onDelete: Cascade` so translations vanish with the parent. Bulk delete is NOT
 *     supported (T-07-03 mirrors T-07-02-09); use status='pending' via the bulk-status
 *     endpoint to "hide".
 *
 *   - AdvertisementTranslation has NO @@unique([advertisement_id, locale]) (Plan 01
 *     schema-truth lock). Update path uses find-then-update (FIRST row per
 *     (advertisement_id, locale) wins). Create path uses createMany — DTO @ArrayMaxSize(2)
 *     + locale union narrows it to ru+kz.
 *
 *   - author_id is set server-side from `actor.id` on create; PATCH does NOT change it.
 *     T-07-03-03: content is plain text on schema (LongText). NOT rendered as HTML by
 *     admin-client (Textarea, NOT Tiptap, per D-08). If a future feature renders
 *     content as HTML, sanitize at write time with isomorphic-dompurify.
 *
 *   - T-07-03-04 (banner.link as phishing payload): link is admin-supplied; admins are
 *     trusted operators. Public site renderers must add `rel="noopener noreferrer"`.
 *
 *   - Unix-second timestamps. created_at + updated_at set on create; updated_at bumped
 *     on every PATCH.
 *
 *   - Cache invalidation (D-19): every successful mutation invalidates
 *     BANNERS_INVALIDATE_PATTERN ('geonline-admin:banners:*') — aggressive nuke since
 *     Plan 03's read-side caching is OFF; the pattern is reserved for the polish pass.
 */
@Injectable()
export class BannersMutationsService {
    private readonly logger = new Logger(BannersMutationsService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly cache: BannersCacheService,
        private readonly detailSvc: BannersDetailService,
    ) {}

    public async create(actor: ScopeActor, dto: UpsertBannerDto): Promise<BannerDetail> {
        if (!dto.slug) throw new BadRequestException('banners.slug_required');
        if (!dto.translations || dto.translations.length === 0) {
            throw new BadRequestException('banners.translations_required');
        }

        const now = Math.floor(Date.now() / 1000);

        const created: any = await this.prisma.$transaction(async (tx) => {
            const a: any = await tx.advertisement.create({
                data: {
                    slug: dto.slug!,
                    author_id: actor.id,
                    image: dto.image ?? null,
                    video: dto.video ?? null,
                    status: dto.status ?? 'pending',
                    enable_comment: dto.enable_comment ?? true,
                    link_type: dto.link_type ?? null,
                    page_type: dto.page_type ?? null,
                    link: dto.link ?? null,
                    visit_count: 0,
                    created_at: now,
                    updated_at: now,
                },
                select: { id: true },
            });

            const kzTranslations = (dto.translations ?? []).filter((t) => t.locale === 'kz');
            if (kzTranslations.length > 0) {
                await tx.advertisementTranslation.createMany({
                    data: kzTranslations.map((t) => ({
                        advertisement_id: a.id,
                        locale: t.locale,
                        title: t.title,
                        description: t.description,
                        content: t.content,
                    })),
                });
            }

            return a;
        });

        await this.cache.invalidate(BANNERS_INVALIDATE_PATTERN);
        await this.cache.invalidate(BANNERS_PUBLIC_INVALIDATE_PATTERN);
        return this.detailSvc.getDetail(Number(created.id));
    }

    public async update(_actor: ScopeActor, id: number, dto: UpsertBannerDto): Promise<BannerDetail> {
        const existing: any = await this.prisma.advertisement.findFirst({
            where: { id },
            select: { id: true },
        });
        if (!existing) throw new NotFoundException('banners.not_found');

        const now = Math.floor(Date.now() / 1000);

        const data: Record<string, unknown> = {};
        if (typeof dto.slug === 'string') data.slug = dto.slug;
        if (dto.image !== undefined) data.image = dto.image;
        if (dto.video !== undefined) data.video = dto.video;
        if (typeof dto.status === 'string') data.status = dto.status;
        if (typeof dto.enable_comment === 'boolean') data.enable_comment = dto.enable_comment;
        if (dto.link_type !== undefined) data.link_type = dto.link_type;
        if (dto.page_type !== undefined) data.page_type = dto.page_type;
        if (dto.link !== undefined) data.link = dto.link;

        const kzTranslations = Array.isArray(dto.translations)
            ? dto.translations.filter((t) => t.locale === 'kz')
            : [];
        const hasField = Object.keys(data).length > 0;
        const hasTranslations = kzTranslations.length > 0;

        if (!hasField && !hasTranslations) {
            // No-op — return current detail.
            return this.detailSvc.getDetail(id);
        }

        await this.prisma.$transaction(async (tx) => {
            if (hasField) {
                data.updated_at = now;
                await tx.advertisement.update({ where: { id }, data });
            } else {
                await tx.advertisement.update({ where: { id }, data: { updated_at: now } });
            }

            if (hasTranslations) {
                for (const t of kzTranslations) {
                    const row: any = await tx.advertisementTranslation.findFirst({
                        where: { advertisement_id: id, locale: t.locale },
                        select: { id: true },
                        orderBy: { id: 'asc' },
                    });
                    if (row) {
                        await tx.advertisementTranslation.update({
                            where: { id: row.id },
                            data: {
                                title: t.title,
                                description: t.description,
                                content: t.content,
                            },
                        });
                    } else {
                        await tx.advertisementTranslation.create({
                            data: {
                                advertisement_id: id,
                                locale: t.locale,
                                title: t.title,
                                description: t.description,
                                content: t.content,
                            },
                        });
                    }
                }
            }
        });

        await this.cache.invalidate(BANNERS_INVALIDATE_PATTERN);
        await this.cache.invalidate(BANNERS_PUBLIC_INVALIDATE_PATTERN);
        return this.detailSvc.getDetail(id);
    }

    public async hardDelete(_actor: ScopeActor, id: number): Promise<{ id: number; deleted: true }> {
        const existing: any = await this.prisma.advertisement.findFirst({
            where: { id },
            select: { id: true },
        });
        if (!existing) throw new NotFoundException('banners.not_found');

        // Translations vanish via FK onDelete: Cascade.
        await this.prisma.advertisement.delete({ where: { id } });

        await this.cache.invalidate(BANNERS_INVALIDATE_PATTERN);
        await this.cache.invalidate(BANNERS_PUBLIC_INVALIDATE_PATTERN);
        return { id, deleted: true };
    }
}
