import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { UpsertBlogDto } from './dto/upsert-blog.dto';
import { BlogsDetailService, type BlogDetail } from './blogs-detail.service';
import { BlogsCacheService } from './utils/blogs-cache.service';
import { BLOGS_INVALIDATE_PATTERN } from './utils/blogs-cache';
import { sanitizeBlogHtmlServer } from './utils/sanitize-html-server';

/**
 * BLG-01 — blog create / update / hard-delete (Plan 04 Task 1).
 *
 * Decisions baked in:
 *
 *   - HARD delete (NOT soft): Blog has NO `deleted_at` column. DELETE removes the row;
 *     `BlogTranslation.blog_id` FK is `onDelete: Cascade` (schema line 1194) so
 *     translations vanish. Bulk delete is NOT supported in bulk-status (T-07-04-10
 *     accepted in threat model).
 *
 *   - BlogTranslation has NO @@unique([blog_id, locale]) (Plan 01 schema-truth lock).
 *     Update path uses find-then-update (FIRST row per (blog_id, locale) wins).
 *
 *   - **Tiptap content sanitization (T-07-04-02 — defense in depth):** every
 *     BlogTranslation.content write — both create and update paths — is wrapped in
 *     `sanitizeBlogHtmlServer(html)` BEFORE persisting. The client (`@/lib/sanitize/sanitize-html`)
 *     also sanitizes via DOMPurify on the editor's onUpdate, but the server is the
 *     FINAL gate. Whitelist mirrors Phase 5 Plan 05 verbatim.
 *
 *   - author_id is set server-side from `actor.id` on create. PATCH does NOT change it
 *     here; author reassignment lives on a dedicated PATCH /:id/author endpoint
 *     (BlogsAuthorService — BLG-03).
 *
 *   - Unix-second timestamps. created_at + updated_at set on create; updated_at bumped
 *     on every PATCH.
 *
 *   - Cache invalidation (D-19): every successful mutation invalidates
 *     BLOGS_INVALIDATE_PATTERN ('geonline-admin:blogs:*').
 *
 *   - category_id existence is pre-checked on create + update (when supplied) and
 *     surfaces 400 'blogs.category_not_found' on miss.
 */
@Injectable()
export class BlogsMutationsService {
    private readonly logger = new Logger(BlogsMutationsService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly cache: BlogsCacheService,
        private readonly detailSvc: BlogsDetailService,
    ) {}

    public async create(actor: ScopeActor, dto: UpsertBlogDto): Promise<BlogDetail> {
        if (!dto.slug) throw new BadRequestException('blogs.slug_required');
        if (typeof dto.category_id !== 'number' || dto.category_id <= 0) {
            throw new BadRequestException('blogs.category_id_required');
        }
        if (!dto.translations || dto.translations.length === 0) {
            throw new BadRequestException('blogs.translations_required');
        }

        // Validate category exists (RESTRICT-style 400 instead of FK violation 500).
        const cat: any = await this.prisma.blogCategory.findFirst({
            where: { id: dto.category_id },
            select: { id: true },
        });
        if (!cat) throw new BadRequestException('blogs.category_not_found');

        const now = Math.floor(Date.now() / 1000);

        const created: any = await this.prisma.$transaction(async (tx) => {
            const b: any = await tx.blog.create({
                data: {
                    slug: dto.slug!,
                    category_id: dto.category_id!,
                    author_id: actor.id,
                    image: dto.image ?? null,
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

            if (dto.translations && dto.translations.length > 0) {
                // T-07-04-02: sanitize content server-side BEFORE persisting (defense
                // in depth — the admin-client also sanitizes via @/lib/sanitize/sanitize-html
                // but the server is the final gate even against tampered clients).
                await tx.blogTranslation.createMany({
                    data: dto.translations.map((t) => ({
                        blog_id: b.id,
                        locale: t.locale,
                        title: t.title,
                        description: t.description,
                        content: sanitizeBlogHtmlServer(t.content),
                    })),
                });
            }

            return b;
        });

        await this.cache.invalidate(BLOGS_INVALIDATE_PATTERN);
        return this.detailSvc.getDetail(Number(created.id));
    }

    public async update(_actor: ScopeActor, id: number, dto: UpsertBlogDto): Promise<BlogDetail> {
        const existing: any = await this.prisma.blog.findFirst({
            where: { id },
            select: { id: true },
        });
        if (!existing) throw new NotFoundException('blogs.not_found');

        // category_id existence (when supplied).
        if (typeof dto.category_id === 'number' && dto.category_id > 0) {
            const cat: any = await this.prisma.blogCategory.findFirst({
                where: { id: dto.category_id },
                select: { id: true },
            });
            if (!cat) throw new BadRequestException('blogs.category_not_found');
        }

        const now = Math.floor(Date.now() / 1000);

        const data: Record<string, unknown> = {};
        if (typeof dto.slug === 'string') data.slug = dto.slug;
        if (typeof dto.category_id === 'number') data.category_id = dto.category_id;
        if (dto.image !== undefined) data.image = dto.image;
        if (typeof dto.status === 'string') data.status = dto.status;
        if (typeof dto.enable_comment === 'boolean') data.enable_comment = dto.enable_comment;
        if (dto.link_type !== undefined) data.link_type = dto.link_type;
        if (dto.page_type !== undefined) data.page_type = dto.page_type;
        if (dto.link !== undefined) data.link = dto.link;

        const hasField = Object.keys(data).length > 0;
        const hasTranslations = Array.isArray(dto.translations) && dto.translations.length > 0;

        if (!hasField && !hasTranslations) {
            // No-op — return current detail.
            return this.detailSvc.getDetail(id);
        }

        await this.prisma.$transaction(async (tx) => {
            if (hasField) {
                data.updated_at = now;
                await tx.blog.update({ where: { id }, data });
            } else {
                await tx.blog.update({ where: { id }, data: { updated_at: now } });
            }

            if (hasTranslations) {
                for (const t of dto.translations!) {
                    // T-07-04-02 — sanitize on EVERY content write (create + update).
                    const sanitizedContent = sanitizeBlogHtmlServer(t.content);
                    const row: any = await tx.blogTranslation.findFirst({
                        where: { blog_id: id, locale: t.locale },
                        select: { id: true },
                        orderBy: { id: 'asc' },
                    });
                    if (row) {
                        await tx.blogTranslation.update({
                            where: { id: row.id },
                            data: {
                                title: t.title,
                                description: t.description,
                                content: sanitizedContent,
                            },
                        });
                    } else {
                        await tx.blogTranslation.create({
                            data: {
                                blog_id: id,
                                locale: t.locale,
                                title: t.title,
                                description: t.description,
                                content: sanitizedContent,
                            },
                        });
                    }
                }
            }
        });

        await this.cache.invalidate(BLOGS_INVALIDATE_PATTERN);
        return this.detailSvc.getDetail(id);
    }

    public async hardDelete(_actor: ScopeActor, id: number): Promise<{ id: number; deleted: true }> {
        const existing: any = await this.prisma.blog.findFirst({
            where: { id },
            select: { id: true },
        });
        if (!existing) throw new NotFoundException('blogs.not_found');

        // Translations cascade via FK onDelete: Cascade (schema line 1194).
        await this.prisma.blog.delete({ where: { id } });

        await this.cache.invalidate(BLOGS_INVALIDATE_PATTERN);
        return { id, deleted: true };
    }
}
