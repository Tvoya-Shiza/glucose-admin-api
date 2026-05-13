import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { CourseCategoryListResponseDto, CourseCategoryRowDto } from './dto/category-row.dto';
import { ListCourseCategoriesDto } from './dto/list-course-categories.dto';

/**
 * Read-only WebinarCategory listing for the admin UI category picker.
 *
 * Schema-truth: WebinarCategory (table `categories`) has no `deleted_at` column —
 * categories are simply inserted/removed. Translations live in
 * `WebinarCategoryTranslation` keyed by locale string ('ru' | 'kz').
 *
 * The `q` filter is applied client-side AFTER the fetch — Prisma cannot easily
 * filter a parent row by a child relation's substring across two locales without
 * `mode: 'insensitive'` on a relation, and the dataset is small enough (< 200 rows)
 * that a single SELECT + in-memory filter is acceptable. If the surface ever grows
 * past a few hundred categories, switch to a raw query with `LIKE` over the joined
 * translations table.
 */
@Injectable()
export class CourseCategoriesService {
    public static readonly DEFAULT_PAGE_SIZE = 50;
    public static readonly MAX_PAGE_SIZE = 200;

    constructor(private readonly prisma: PrismaService) {}

    public async list(query: ListCourseCategoriesDto): Promise<CourseCategoryListResponseDto> {
        const cap = Math.min(
            query.page_size ?? CourseCategoriesService.DEFAULT_PAGE_SIZE,
            CourseCategoriesService.MAX_PAGE_SIZE,
        );

        const rows: any[] = await this.prisma.webinarCategory.findMany({
            orderBy: [{ order: 'asc' }, { id: 'asc' }],
            select: {
                id: true,
                parent_id: true,
                slug: true,
                icon: true,
                translations: { select: { locale: true, title: true } },
            },
        });

        const flat: CourseCategoryRowDto[] = rows.map((r) => {
            const ts = (r.translations ?? []) as Array<{ locale: string; title: string }>;
            const ru = ts.find((t) => t.locale === 'ru');
            const kz = ts.find((t) => t.locale === 'kz');
            return {
                id: Number(r.id),
                parent_id: r.parent_id != null ? Number(r.parent_id) : null,
                slug: r.slug,
                icon: r.icon ?? null,
                title_ru: ru?.title ?? null,
                title_kz: kz?.title ?? null,
            };
        });

        const filtered = query.q
            ? flat.filter((row) => {
                  const needle = query.q!.toLowerCase();
                  return (
                      (row.title_ru?.toLowerCase().includes(needle) ?? false) ||
                      (row.title_kz?.toLowerCase().includes(needle) ?? false) ||
                      row.slug.toLowerCase().includes(needle)
                  );
              })
            : flat;

        return { rows: filtered.slice(0, cap), total: filtered.length };
    }
}
