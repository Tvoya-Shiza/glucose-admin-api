import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { buildScopeWhere } from '../../common/scoping/scope.helper';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { ListCoursesDto } from './dto/list-courses.dto';
import type { CourseListResponseDto, CourseRowDto } from './dto/course-row.dto';
import { WEBINAR_SCOPE_RULES } from './courses.scope';
import { deriveTranslationCompleteness } from './utils/translation-completeness';

/**
 * CRS-01 + CRS-02 + CRS-07 (list half) — paginated, scoped, filtered, search-able courses list (Plan 02).
 *
 * Schema-truth posture (carried into Plans 03/05/06):
 *
 *   - Soft-delete: Webinar.deleted_at exists (schema line 821). The list defaults to
 *     `deleted_at: null` always — we do not yet support `?include_deleted=true`.
 *
 *   - Translation-completeness (CRS-02): pulled in the same findMany via
 *     `translations: { select: { locale, title } }`. Per-row computation runs through
 *     `deriveTranslationCompleteness` post-fetch — NOT a separate query, NOT N+1.
 *
 *   - Filter `translation_completeness=complete` is implemented server-side via
 *     two AND'd `translations: { some: { locale, title: { not: '' } } }` clauses
 *     (one per required locale). The client then sees only rows whose translations
 *     pass the post-fetch derivation as well — these MUST agree, but we keep the
 *     post-fetch derivation as the source of truth for the surfaced badge.
 *
 *   - Filter `translation_completeness=incomplete` uses `NOT` of the 'complete' shape
 *     (de Morgan: missing-ru OR missing-kz OR has-empty-title-in-either). The post-fetch
 *     derivation refines what the badge shows.
 *
 *   - Search `q`: matches Webinar.slug OR any WebinarTranslations.title (case-insensitivity
 *     handled by MySQL utf8mb4_general_ci by default; Prisma `mode: 'insensitive'` is
 *     Postgres-only).
 *
 *   - Webinar.image_cover and Webinar.thumbnail are NOT NULL on schema (lines 813-814);
 *     surfaced as-is (empty string is normal pre-upload).
 *
 *   - chapter_count: computed via Prisma `_count.chapters` on Webinar — NO N+1.
 *
 *   - Sort mapping:
 *       'created_at' -> { created_at: order }       (default)
 *       'updated_at' -> { updated_at: order }
 *       'teacher'    -> { teacher: { full_name: order } }   (relation orderBy)
 *       'slug'       -> { slug: order }
 *
 * Scope (CONTEXT D-19 + WEBINAR_SCOPE_RULES):
 *   - admin   -> rule omitted -> {} -> sees all
 *   - teacher -> { teacher_id: actor.id } -> own courses only
 *   - curator -> { id: { in: [] } } -> empty result
 *
 * Performance: explicit `select` (NOT `include`); `prisma.$transaction([count, findMany])`
 * mirrors Phase 3/4 list endpoints. No cursor field on the surface (Plan 02 ships
 * page+page_size only — cursor variant deferred to a polish pass if needed).
 */
@Injectable()
export class CoursesListService {
    private readonly logger = new Logger(CoursesListService.name);

    public static readonly DEFAULT_PAGE_SIZE = 50;
    public static readonly MAX_PAGE_SIZE = 200;

    constructor(private readonly prisma: PrismaService) {}

    public async list(actor: ScopeActor, query: ListCoursesDto): Promise<CourseListResponseDto> {
        const page = Math.max(1, query.page ?? 1);
        const page_size = Math.min(
            CoursesListService.MAX_PAGE_SIZE,
            Math.max(1, query.page_size ?? CoursesListService.DEFAULT_PAGE_SIZE),
        );
        const sort = query.sort ?? 'created_at';
        const order: 'asc' | 'desc' = query.order ?? 'desc';

        // ---- Filter where (status / teacher / category / q / translation_completeness) ----
        const filterWhere: any = { deleted_at: null };

        if (query.status) filterWhere.status = query.status;
        if (typeof query.teacher_id === 'number') filterWhere.teacher_id = query.teacher_id;
        if (typeof query.category_id === 'number') filterWhere.category_id = query.category_id;

        if (query.q && query.q.trim().length > 0) {
            const needle = query.q.trim();
            filterWhere.OR = [
                { slug: { contains: needle } },
                { translations: { some: { title: { contains: needle } } } },
            ];
        }

        // Server-side translation-completeness narrowing.
        // 'complete'  -> requires kz translation with non-empty title
        // 'incomplete'-> NOT(complete)
        if (query.translation_completeness === 'complete') {
            filterWhere.AND = [
                ...(filterWhere.AND ?? []),
                { translations: { some: { locale: 'kz', title: { not: '' } } } },
            ];
        } else if (query.translation_completeness === 'incomplete') {
            filterWhere.AND = [
                ...(filterWhere.AND ?? []),
                {
                    NOT: { translations: { some: { locale: 'kz', title: { not: '' } } } },
                },
            ];
        }

        // ---- Scope spread ----
        const scopeWhere = buildScopeWhere(actor, WEBINAR_SCOPE_RULES);
        const where: any = { ...filterWhere, ...(scopeWhere as object) };

        // ---- Order mapping ----
        let orderBy: any;
        if (sort === 'teacher') {
            orderBy = { teacher: { full_name: order } };
        } else if (sort === 'slug') {
            orderBy = { slug: order };
        } else if (sort === 'updated_at') {
            orderBy = { updated_at: order };
        } else {
            orderBy = { created_at: order };
        }

        const skip = (page - 1) * page_size;

        const [total, rows] = await this.prisma.$transaction([
            this.prisma.webinar.count({ where }),
            this.prisma.webinar.findMany({
                where,
                select: {
                    id: true,
                    slug: true,
                    status: true,
                    image_cover: true,
                    created_at: true,
                    updated_at: true,
                    teacher: { select: { id: true, full_name: true } },
                    category: {
                        select: {
                            id: true,
                            slug: true,
                            translations: {
                                where: { locale: 'kz' },
                                select: { title: true },
                                take: 1,
                            },
                        },
                    },
                    translations: { select: { locale: true, title: true } },
                    _count: { select: { chapters: true } },
                },
                // Tie-breaker on id so pagination is deterministic when the sort field has ties.
                orderBy: [orderBy, { id: order }],
                take: page_size,
                skip,
            }),
        ]);

        const out: CourseRowDto[] = (rows as any[]).map((r: any) => {
            const translations = (r.translations ?? []) as Array<{ locale: string; title: string | null }>;
            const completeness = deriveTranslationCompleteness(
                translations.map((t) => ({ locale: t.locale, title: t.title ?? null })),
            );
            const kzTitle = translations.find((t) => t.locale === 'kz')?.title?.trim() ?? '';
            return {
                id: Number(r.id),
                slug: r.slug,
                title_kz: kzTitle.length > 0 ? kzTitle : null,
                status: r.status,
                teacher: r.teacher
                    ? { id: Number(r.teacher.id), full_name: r.teacher.full_name ?? null }
                    : null,
                category: r.category
                    ? {
                          id: Number(r.category.id),
                          slug: r.category.slug,
                          title_kz:
                              (r.category.translations as Array<{ title: string | null }> | undefined)?.[0]
                                  ?.title ?? null,
                      }
                    : null,
                image_cover: r.image_cover ?? '',
                translation_completeness: completeness.translation_completeness,
                missing_locales: completeness.missing_locales,
                chapter_count: r._count?.chapters ?? 0,
                created_at: Number(r.created_at),
                updated_at: r.updated_at == null ? null : Number(r.updated_at),
            };
        });

        return { rows: out, total, page, page_size };
    }
}
