import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { buildScopeWhere } from '../../common/scoping/scope.helper';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { ListStoriesDto } from './dto/list-stories.dto';
import { STORY_SCOPE_RULES } from './stories.scope';

/**
 * STY-01 — paginated, scoped, filtered, search-able stories list (Plan 02).
 *
 * Schema-truth posture (Plan 01 lock):
 *   - Story has NO `deleted_at`, NO `is_active`, NO `sort_order`.
 *   - Story.status is `BlogStatus` enum ('pending' | 'publish').
 *   - Story.created_at / updated_at are Unix seconds (`Int @db.UnsignedInt`).
 *   - StoryTranslation has NO @@unique([story_id, locale]); service-side dedup.
 *
 * Scope (D-20): runtime-RBAC-driven — all roles omitted from STORY_SCOPE_RULES ->
 * buildScopeWhere returns {} -> each admitted role sees all rows IF granted
 * stories.view. Unknown roles fail closed via scope.helper's default branch.
 *
 * Performance: explicit `select`/`include` blend, `prisma.$transaction([count, findMany])`
 * mirrors Phase 3/5 list endpoints. Tie-breaker on `id` for deterministic pagination.
 *
 * Response shape: raw `{ rows, total, pageCount }` (CLAUDE.md — list endpoints don't
 * wrap with apiResponse; admin-client TanStack Table consumes the raw shape).
 */
export interface StoryListRow {
    id: number;
    slug: string;
    image: string | null;
    icon: string | null;
    video: string | null;
    status: 'pending' | 'publish';
    author_id: number;
    visit_count: number;
    created_at: number;
    updated_at: number;
    title_kz: string | null;
    author_full_name: string | null;
}

export interface StoryListResponse {
    rows: StoryListRow[];
    total: number;
    pageCount: number;
}

@Injectable()
export class StoriesListService {
    private readonly logger = new Logger(StoriesListService.name);

    public static readonly DEFAULT_PAGE_SIZE = 50;
    public static readonly MAX_PAGE_SIZE = 200;

    constructor(private readonly prisma: PrismaService) {}

    public async list(actor: ScopeActor, query: ListStoriesDto): Promise<StoryListResponse> {
        const page = Math.max(1, query.page ?? 1);
        const page_size = Math.min(
            StoriesListService.MAX_PAGE_SIZE,
            Math.max(1, query.page_size ?? StoriesListService.DEFAULT_PAGE_SIZE),
        );
        const sort = query.sort ?? 'created_at';
        const order: 'asc' | 'desc' = query.order ?? 'desc';

        // Filter where (status / q).
        const filterWhere: any = {};
        if (query.status) filterWhere.status = query.status;

        if (query.q && query.q.trim().length > 0) {
            const needle = query.q.trim();
            filterWhere.OR = [
                { slug: { contains: needle } },
                { translations: { some: { title: { contains: needle } } } },
            ];
        }

        // Scope spread (all admitted roles see all rows; governed by @RequirePermission).
        const scopeWhere = buildScopeWhere(actor, STORY_SCOPE_RULES);
        const where: any = { ...filterWhere, ...(scopeWhere as object) };

        // orderBy
        let orderBy: any;
        if (sort === 'updated_at') orderBy = { updated_at: order };
        else if (sort === 'visit_count') orderBy = { visit_count: order };
        else orderBy = { created_at: order };

        const skip = (page - 1) * page_size;

        const [total, rows] = await this.prisma.$transaction([
            this.prisma.story.count({ where }),
            this.prisma.story.findMany({
                where,
                select: {
                    id: true,
                    slug: true,
                    image: true,
                    icon: true,
                    video: true,
                    status: true,
                    author_id: true,
                    visit_count: true,
                    created_at: true,
                    updated_at: true,
                    translations: { select: { locale: true, title: true } },
                    author: { select: { full_name: true } },
                },
                orderBy: [orderBy, { id: order }],
                take: page_size,
                skip,
            }),
        ]);

        const out: StoryListRow[] = (rows as any[]).map((r: any) => {
            const kz = (r.translations ?? []).find((t: any) => t.locale === 'kz');
            return {
                id: Number(r.id),
                slug: r.slug,
                image: r.image ?? null,
                icon: r.icon ?? null,
                video: r.video ?? null,
                status: r.status as 'pending' | 'publish',
                author_id: Number(r.author_id),
                visit_count: Number(r.visit_count ?? 0),
                created_at: Number(r.created_at),
                updated_at: Number(r.updated_at ?? r.created_at),
                title_kz: kz?.title ?? null,
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
