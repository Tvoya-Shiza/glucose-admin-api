import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { UpsertStoryDto } from './dto/upsert-story.dto';
import { StoriesDetailService, type StoryDetail } from './stories-detail.service';
import { StoriesCacheService } from './utils/stories-cache.service';
import { STORIES_INVALIDATE_PATTERN, STORIES_PUBLIC_INVALIDATE_PATTERN } from './utils/stories-cache';

/**
 * STY-01 — story create / update / hard-delete (Plan 02 Task 1).
 *
 * Decisions baked in:
 *
 *   - HARD delete (NOT soft): Story has NO `deleted_at` column. DELETE is a row removal;
 *     `StoryTranslation.story_id` FK is `onDelete: Cascade` (schema line 1308) so
 *     translations vanish with the parent. Bulk delete is NOT supported (T-07-02-09
 *     accepted in threat model — stories have no active mutating relations beyond
 *     translations); use status='pending' via the bulk-status endpoint to "hide".
 *
 *   - StoryTranslation has NO @@unique([story_id, locale]) (Plan 01 schema-truth lock).
 *     Update path uses find-then-update (FIRST row per (story_id, locale) wins).
 *     Create path uses createMany — DTO @ArrayMaxSize(2) + locale union narrows it to
 *     ru+kz; conflicting duplicates would require a malicious payload that bypasses
 *     class-validator (the @IsIn locale gate prevents non-ru/kz; @ArrayMaxSize(2)
 *     prevents three rows; same locale twice is theoretically possible but the
 *     admin-client form binds one input per locale).
 *
 *   - author_id is set server-side from `actor.id` on create; PATCH does NOT change it.
 *     T-07-02-04: content is plain text on schema (LongText). NOT rendered as HTML by
 *     admin-client. If a future feature renders content as HTML, sanitize at write
 *     time with isomorphic-dompurify (Phase 5 Plan 05 pattern).
 *
 *   - Unix-second timestamps. created_at + updated_at set on create; updated_at bumped
 *     on every PATCH.
 *
 *   - Cache invalidation (D-19): every successful mutation invalidates
 *     STORIES_INVALIDATE_PATTERN ('geonline-admin:stories:*') — aggressive nuke since
 *     Plan 02's read-side caching is OFF; the pattern is reserved for the polish pass.
 */
@Injectable()
export class StoriesMutationsService {
    private readonly logger = new Logger(StoriesMutationsService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly cache: StoriesCacheService,
        private readonly detailSvc: StoriesDetailService,
    ) {}

    public async create(actor: ScopeActor, dto: UpsertStoryDto): Promise<StoryDetail> {
        if (!dto.slug) throw new BadRequestException('stories.slug_required');
        if (!dto.translations || dto.translations.length === 0) {
            throw new BadRequestException('stories.translations_required');
        }

        const now = Math.floor(Date.now() / 1000);

        const created: any = await this.prisma.$transaction(async (tx) => {
            const s: any = await tx.story.create({
                data: {
                    slug: dto.slug!,
                    author_id: actor.id,
                    image: dto.image ?? null,
                    icon: dto.icon ?? null,
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
                await tx.storyTranslation.createMany({
                    data: kzTranslations.map((t) => ({
                        story_id: s.id,
                        locale: t.locale,
                        title: t.title,
                        description: t.description,
                        content: t.content,
                    })),
                });
            }

            return s;
        });

        await this.cache.invalidate(STORIES_INVALIDATE_PATTERN);
        await this.cache.invalidate(STORIES_PUBLIC_INVALIDATE_PATTERN);
        return this.detailSvc.getDetail(Number(created.id));
    }

    public async update(_actor: ScopeActor, id: number, dto: UpsertStoryDto): Promise<StoryDetail> {
        const existing: any = await this.prisma.story.findFirst({
            where: { id },
            select: { id: true },
        });
        if (!existing) throw new NotFoundException('stories.not_found');

        const now = Math.floor(Date.now() / 1000);

        const data: Record<string, unknown> = {};
        if (typeof dto.slug === 'string') data.slug = dto.slug;
        if (dto.image !== undefined) data.image = dto.image;
        if (dto.icon !== undefined) data.icon = dto.icon;
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
                await tx.story.update({ where: { id }, data });
            } else {
                await tx.story.update({ where: { id }, data: { updated_at: now } });
            }

            if (hasTranslations) {
                for (const t of kzTranslations) {
                    const row: any = await tx.storyTranslation.findFirst({
                        where: { story_id: id, locale: t.locale },
                        select: { id: true },
                        orderBy: { id: 'asc' },
                    });
                    if (row) {
                        await tx.storyTranslation.update({
                            where: { id: row.id },
                            data: {
                                title: t.title,
                                description: t.description,
                                content: t.content,
                            },
                        });
                    } else {
                        await tx.storyTranslation.create({
                            data: {
                                story_id: id,
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

        await this.cache.invalidate(STORIES_INVALIDATE_PATTERN);
        await this.cache.invalidate(STORIES_PUBLIC_INVALIDATE_PATTERN);
        return this.detailSvc.getDetail(id);
    }

    public async hardDelete(_actor: ScopeActor, id: number): Promise<{ id: number; deleted: true }> {
        const existing: any = await this.prisma.story.findFirst({
            where: { id },
            select: { id: true },
        });
        if (!existing) throw new NotFoundException('stories.not_found');

        // Translations vanish via FK onDelete: Cascade (schema line 1308).
        await this.prisma.story.delete({ where: { id } });

        await this.cache.invalidate(STORIES_INVALIDATE_PATTERN);
        await this.cache.invalidate(STORIES_PUBLIC_INVALIDATE_PATTERN);
        return { id, deleted: true };
    }
}
