import {
    BadRequestException,
    ConflictException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { CourseCategoryListResponseDto, CourseCategoryRowDto } from './dto/category-row.dto';
import { ListCourseCategoriesDto } from './dto/list-course-categories.dto';
import { UpsertCourseCategoryDto } from './dto/upsert-course-category.dto';

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
            const kz = ts.find((t) => t.locale === 'kz');
            return {
                id: Number(r.id),
                parent_id: r.parent_id != null ? Number(r.parent_id) : null,
                slug: r.slug,
                icon: r.icon ?? null,
                title_kz: kz?.title ?? null,
            };
        });

        const filtered = query.q
            ? flat.filter((row) => {
                  const needle = query.q!.toLowerCase();
                  return (
                      (row.title_kz?.toLowerCase().includes(needle) ?? false) ||
                      row.slug.toLowerCase().includes(needle)
                  );
              })
            : flat;

        return { rows: filtered.slice(0, cap), total: filtered.length };
    }

    public async create(dto: UpsertCourseCategoryDto): Promise<CourseCategoryRowDto> {
        const slug = dto.slug?.trim();
        if (!slug) {
            throw new BadRequestException('course_categories.slug_required');
        }

        const dupe = await this.prisma.webinarCategory.findFirst({
            where: { slug },
            select: { id: true },
        });
        if (dupe) {
            throw new ConflictException('course_categories.slug_already_exists');
        }

        const created = await this.prisma.webinarCategory.create({
            data: {
                slug,
                ...(dto.title_kz && dto.title_kz.trim().length > 0
                    ? {
                          translations: {
                              create: [{ locale: 'kz', title: dto.title_kz.trim() }],
                          },
                      }
                    : {}),
            },
            select: { id: true },
        });

        return this.requireById(created.id);
    }

    public async update(id: number, dto: UpsertCourseCategoryDto): Promise<CourseCategoryRowDto> {
        const existing = await this.prisma.webinarCategory.findUnique({
            where: { id },
            select: { id: true, slug: true },
        });
        if (!existing) throw new NotFoundException('course_categories.not_found');

        const nextSlug = dto.slug?.trim();
        if (nextSlug && nextSlug !== existing.slug) {
            const dupe = await this.prisma.webinarCategory.findFirst({
                where: { slug: nextSlug, id: { not: id } },
                select: { id: true },
            });
            if (dupe) {
                throw new ConflictException('course_categories.slug_already_exists');
            }
        }

        await this.prisma.$transaction(async (tx) => {
            if (nextSlug && nextSlug !== existing.slug) {
                await tx.webinarCategory.update({
                    where: { id },
                    data: { slug: nextSlug },
                });
            }
            if (dto.title_kz !== undefined) {
                const title = dto.title_kz.trim();
                if (title.length === 0) {
                    await tx.webinarCategoryTranslation.deleteMany({
                        where: { category_id: id, locale: 'kz' },
                    });
                } else {
                    const existingTr = await tx.webinarCategoryTranslation.findFirst({
                        where: { category_id: id, locale: 'kz' },
                        select: { id: true },
                    });
                    if (existingTr) {
                        await tx.webinarCategoryTranslation.update({
                            where: { id: existingTr.id },
                            data: { title },
                        });
                    } else {
                        await tx.webinarCategoryTranslation.create({
                            data: { category_id: id, locale: 'kz', title },
                        });
                    }
                }
            }
        });

        return this.requireById(id);
    }

    /**
     * Delete a category. Blocks (409) when courses or child categories reference
     * the row — operator decides what to do (reassign / delete dependents) before
     * retrying. No force-cascade option in v1 (the user explicitly chose the
     * "check first" policy over force-cascade).
     */
    public async remove(id: number): Promise<{ deleted: true; id: number }> {
        const existing = await this.prisma.webinarCategory.findUnique({
            where: { id },
            select: { id: true },
        });
        if (!existing) throw new NotFoundException('course_categories.not_found');

        const [course_count, child_count] = await this.prisma.$transaction([
            this.prisma.webinar.count({ where: { category_id: id, deleted_at: null } }),
            this.prisma.webinarCategory.count({ where: { parent_id: id } }),
        ]);
        if (course_count > 0 || child_count > 0) {
            throw new ConflictException({
                message: 'course_categories.has_dependents',
                course_count,
                child_count,
            });
        }

        await this.prisma.$transaction([
            this.prisma.webinarCategoryTranslation.deleteMany({ where: { category_id: id } }),
            this.prisma.webinarCategory.delete({ where: { id } }),
        ]);
        return { deleted: true, id };
    }

    private async requireById(id: number): Promise<CourseCategoryRowDto> {
        const row = await this.prisma.webinarCategory.findUnique({
            where: { id },
            select: {
                id: true,
                parent_id: true,
                slug: true,
                icon: true,
                translations: { select: { locale: true, title: true } },
            },
        });
        if (!row) throw new NotFoundException('course_categories.not_found');
        const ts = (row.translations ?? []) as Array<{ locale: string; title: string }>;
        const kz = ts.find((t) => t.locale === 'kz');
        return {
            id: Number(row.id),
            parent_id: row.parent_id != null ? Number(row.parent_id) : null,
            slug: row.slug,
            icon: row.icon ?? null,
            title_kz: kz?.title ?? null,
        };
    }
}
