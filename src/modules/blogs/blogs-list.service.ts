import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { buildScopeWhere } from '../../common/scoping/scope.helper';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { ListBlogsDto } from './dto/list-blogs.dto';
import { BLOG_SCOPE_RULES } from './blogs.scope';

/**
 * BLG-01 — paginated, scoped, filtered, search-able blogs list (Plan 04).
 *
 * Schema-truth posture (Plan 01 lock):
 *   - Blog has NO `deleted_at`, NO `is_active`, NO `sort_order`.
 *   - Blog has `image` ONLY (no icon, no video — diverges from Story/Advertisement).
 *   - Blog.status is `BlogStatus` enum ('pending' | 'publish').
 *   - Blog.created_at / updated_at are Unix seconds.
 *   - BlogTranslation has NO @@unique([blog_id, locale]); service-side dedup.
 *
 * Scope (D-20):
 *   - admin   -> rule omitted -> {} -> sees all
 *   - teacher -> { id: { in: [] } } -> empty result
 *   - curator -> { id: { in: [] } } -> empty result
 *
 * Response shape: raw `{ rows, total, pageCount }` (CLAUDE.md — list endpoints don't
 * wrap with apiResponse; admin-client TanStack Table consumes the raw shape).
 */
export interface BlogListRow {
    id: number;
    slug: string;
    image: string | null;
    status: 'pending' | 'publish';
    category_id: number;
    author_id: number;
    visit_count: number;
    created_at: number;
    updated_at: number;
    title_kz: string | null;
    category_title_kz: string | null;
    author_full_name: string | null;
}

export interface BlogListResponse {
    rows: BlogListRow[];
    total: number;
    pageCount: number;
}

@Injectable()
export class BlogsListService {
    private readonly logger = new Logger(BlogsListService.name);

    public static readonly DEFAULT_PAGE_SIZE = 50;
    public static readonly MAX_PAGE_SIZE = 200;

    constructor(private readonly prisma: PrismaService) {}

    public async list(actor: ScopeActor, query: ListBlogsDto): Promise<BlogListResponse> {
        const page = Math.max(1, query.page ?? 1);
        const page_size = Math.min(
            BlogsListService.MAX_PAGE_SIZE,
            Math.max(1, query.page_size ?? BlogsListService.DEFAULT_PAGE_SIZE),
        );
        const sort = query.sort ?? 'created_at';
        const order: 'asc' | 'desc' = query.order ?? 'desc';

        // Filter where (status / category / author / q).
        const filterWhere: any = {};
        if (query.status) filterWhere.status = query.status;
        if (typeof query.category_id === 'number') filterWhere.category_id = query.category_id;
        if (typeof query.author_id === 'number') filterWhere.author_id = query.author_id;

        if (query.q && query.q.trim().length > 0) {
            const needle = query.q.trim();
            filterWhere.OR = [
                { slug: { contains: needle } },
                { translations: { some: { title: { contains: needle } } } },
            ];
        }

        // Scope spread (admin sees all; non-admin -> empty).
        const scopeWhere = buildScopeWhere(actor, BLOG_SCOPE_RULES);
        const where: any = { ...filterWhere, ...(scopeWhere as object) };

        // orderBy
        let orderBy: any;
        if (sort === 'updated_at') orderBy = { updated_at: order };
        else if (sort === 'visit_count') orderBy = { visit_count: order };
        else orderBy = { created_at: order };

        const skip = (page - 1) * page_size;

        const [total, rows] = await this.prisma.$transaction([
            this.prisma.blog.count({ where }),
            this.prisma.blog.findMany({
                where,
                select: {
                    id: true,
                    slug: true,
                    image: true,
                    status: true,
                    category_id: true,
                    author_id: true,
                    visit_count: true,
                    created_at: true,
                    updated_at: true,
                    translations: { select: { locale: true, title: true } },
                    category: {
                        select: {
                            translations: {
                                where: { locale: 'kz' },
                                select: { title: true },
                                take: 1,
                            },
                        },
                    },
                    author: { select: { full_name: true } },
                },
                orderBy: [orderBy, { id: order }],
                take: page_size,
                skip,
            }),
        ]);

        const out: BlogListRow[] = (rows as any[]).map((r: any) => {
            const kz = (r.translations ?? []).find((t: any) => t.locale === 'kz');
            return {
                id: Number(r.id),
                slug: r.slug,
                image: r.image ?? null,
                status: r.status as 'pending' | 'publish',
                category_id: Number(r.category_id),
                author_id: Number(r.author_id),
                visit_count: Number(r.visit_count ?? 0),
                created_at: Number(r.created_at),
                updated_at: Number(r.updated_at ?? r.created_at),
                title_kz: kz?.title ?? null,
                category_title_kz: r.category?.translations?.[0]?.title ?? null,
                author_full_name: r.author?.full_name ?? null,
            };
        });

        return {
            rows: out,
            total: Number(total),
            pageCount: Math.max(1, Math.ceil(Number(total) / page_size)),
        };
    }
}
