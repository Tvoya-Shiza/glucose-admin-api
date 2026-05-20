import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { ScopeActor } from '../../common/scoping/scope.types';
import type { CourseDetailDto, ChapterDto, ChapterItemDto, TranslationRowDto } from './dto/course-detail.dto';
import { deriveTranslationCompleteness } from './utils/translation-completeness';
import { CoursesCacheService } from './utils/courses-cache.service';
import { buildCourseDetailCacheKey } from './utils/course-cache';

/**
 * CRS-01 + CRS-07 — course detail (Plan 03).
 *
 * 403-not-404 hard rule (carry-over from Phase 4 Plan 03 GroupsDetail, mandated by
 * CONTEXT D-19 + ROADMAP §"Phase 5" success criterion #4):
 *
 *   "teacher A cannot see teacher B's course via direct URL access; admin-api
 *    returns 403, not 404 or 200"
 *
 * Group existence — and now course existence — is operationally non-sensitive for
 * staff. The explicit 403 helps a teacher understand they're hitting a course they
 * don't own, rather than mistakenly thinking the course was deleted. This DIVERGES
 * from Phase 3's user-detail posture (which returns 404 for out-of-scope) but
 * matches the Phase 4 Groups divergence verbatim.
 *
 * Implementation pattern (3 steps — identical shape to GroupsDetailService):
 *   1. Existence check WITHOUT scope spread — was the course ever real?
 *      Soft-deleted (deleted_at != null) counts as absent → 404.
 *   2. Scope check on the loaded row — does this actor have access?
 *        admin            → always allowed
 *        teacher (own)    → allowed iff teacher_id === actor.id
 *        teacher (other)  → 403 'courses.forbidden_scope'
 *        curator          → 403 'courses.forbidden_scope' (default-deny per
 *                            WEBINAR_SCOPE_RULES.curator; controller @Roles still
 *                            permits curator for surface uniformity, the service
 *                            assertion is what actually enforces the gate).
 *      Failure → ForbiddenException('courses.forbidden_scope').
 *   3. Re-read with full select shape (single Prisma query with nested selects —
 *      no N+1; chapters + items + translations all ride the same query). Race
 *      window between step 1 and step 3 → defensive 404 if the row vanished
 *      (concurrent soft-delete, T-05-22 mitigation).
 *
 * schedule_count derivation: WebinarChapterSchedule has no webinar_id / chapter_id
 * columns (Plan 01 schema-truth note). It links via webinar_chapter_item_id only.
 * The count is therefore an aggregate over `webinar_chapter_item_id IN <this course's
 * item ids>`. Two queries total: (1) the nested webinar+chapters+items findFirst,
 * (2) the schedule count. NOT N+1 — both are bounded.
 *
 * Caching: read-through via CoursesCacheService.getOrSet, key
 *   geonline-admin:courses:detail:<id>:scope:<role>:<id>
 * (scope-suffixed so teacher narrowing never leaks to a different actor's view).
 * TTL 300s (5 min). Invalidated by mutations service on PATCH/DELETE.
 *
 * NOTE: cache READ happens AFTER the existence + scope check so foreign-teacher
 * access still emits the 403 (cache lookup is bypassed for out-of-scope actors).
 */
@Injectable()
export class CoursesDetailService {
    private readonly logger = new Logger(CoursesDetailService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly cache: CoursesCacheService,
    ) {}

    public async getDetail(actor: ScopeActor, id: number): Promise<CourseDetailDto> {
        // Step 1: Existence check WITHOUT scope spread; soft-deleted (deleted_at != null) = absent.
        const exists: any = await this.prisma.webinar.findFirst({
            where: { id, deleted_at: null },
            select: { id: true, teacher_id: true },
        });
        if (!exists) {
            throw new NotFoundException('courses.not_found');
        }

        // Step 2: Scope check on the loaded row.
        // admin always passes; teacher must own the course; curator (and any other
        // role) is default-deny per WEBINAR_SCOPE_RULES.
        if (actor.role_name !== 'admin') {
            const allowed =
                actor.role_name === 'teacher' && Number(exists.teacher_id) === actor.id;
            if (!allowed) {
                throw new ForbiddenException('courses.forbidden_scope');
            }
        }

        // Step 3: Re-read with full select shape (cached read-through).
        const cacheKey = buildCourseDetailCacheKey(actor, id);
        return this.cache.getOrSet(cacheKey, () => this.readFullDetail(id));
    }

    /**
     * Single $transaction-equivalent read: nested findFirst + a follow-up count
     * over the gathered item ids. Both queries bounded; no N+1.
     */
    private async readFullDetail(id: number): Promise<CourseDetailDto> {
        const row: any = await this.prisma.webinar.findFirst({
            where: { id, deleted_at: null },
            select: {
                id: true,
                slug: true,
                type: true,
                status: true,
                image_cover: true,
                thumbnail: true,
                capacity: true,
                certificate: true,
                is_paid: true,
                prices: { select: { id: true, price: true, access_days: true }, orderBy: { id: 'asc' }, take: 1 },
                start_date: true,
                duration: true,
                position: true,
                created_at: true,
                updated_at: true,
                deleted_at: true,
                teacher: { select: { id: true, full_name: true, email: true } },
                category: {
                    select: {
                        id: true,
                        slug: true,
                        translations: { select: { locale: true, title: true } },
                    },
                },
                translations: { select: { locale: true, title: true, description: true } },
                chapters: {
                    select: {
                        id: true,
                        order: true,
                        status: true,
                        translations: { select: { locale: true, title: true } },
                        items: {
                            select: {
                                id: true,
                                type: true,
                                order: true,
                                item_id: true,
                                // Plan 05 will join Files / Quizzes / WebinarAssignment via item_id;
                                // for Plan 03, surface only the raw item_id — UI labels by `type`.
                            },
                            orderBy: [{ order: 'asc' }, { id: 'asc' }],
                        },
                    },
                    orderBy: [{ order: 'asc' }, { id: 'asc' }],
                },
                _count: { select: { chapters: true } },
            },
        });

        // Race window: between step 1 (existence) and this re-read a concurrent
        // soft-delete could have landed. Defensive 404 (T-05-22 mitigation).
        if (!row) {
            throw new NotFoundException('courses.not_found');
        }

        // Aggregate item ids → schedule_count via WebinarChapterSchedule.count
        // (no direct Webinar→Schedule relation — schedules link via webinar_chapter_item_id only,
        // per Plan 01 schema-truth note).
        const itemIds: number[] = (row.chapters as any[]).flatMap((c: any) =>
            (c.items as any[]).map((i: any) => Number(i.id)),
        );
        const schedule_count =
            itemIds.length === 0
                ? 0
                : await this.prisma.webinarChapterSchedule.count({
                      where: { webinar_chapter_item_id: { in: itemIds } },
                  });

        // Top-level translations.
        const translations: TranslationRowDto[] = (row.translations ?? [])
            .filter((t: any) => t.locale === 'kz')
            .map((t: any) => ({
                locale: 'kz' as const,
                title: t.title,
                description: t.description ?? null,
            }));

        const completeness = deriveTranslationCompleteness(
            translations.map((t) => ({ locale: t.locale, title: t.title })),
        );

        // Category title from joined translations array (kz only).
        let title_kz: string | null = null;
        if (row.category && Array.isArray(row.category.translations)) {
            for (const ct of row.category.translations) {
                if (ct.locale === 'kz' && (ct.title ?? '').length > 0) title_kz = ct.title;
            }
        }

        // Chapters + items.
        const chapters: ChapterDto[] = (row.chapters as any[]).map((c: any) => {
            const cTranslations: TranslationRowDto[] = (c.translations ?? [])
                .filter((t: any) => t.locale === 'kz')
                .map((t: any) => ({
                    locale: 'kz' as const,
                    title: t.title,
                    description: null, // schema has no description column on chapter translations
                }));

            const items: ChapterItemDto[] = (c.items as any[]).map((it: any) => ({
                id: Number(it.id),
                type: it.type as 'file' | 'quiz' | 'assignment',
                order: it.order == null ? null : Number(it.order),
                item_id: Number(it.item_id),
                // Plan 03 surfaces the raw item_id only — Plan 05 will hydrate file/quiz/assignment refs.
                file: null,
                quiz: null,
                assignment: null,
                translations: [],
            }));

            return {
                id: Number(c.id),
                order: c.order == null ? null : Number(c.order),
                status: c.status as 'active' | 'inactive',
                translations: cTranslations,
                items,
            };
        });

        return {
            id: Number(row.id),
            slug: row.slug,
            type: row.type,
            status: row.status,
            teacher: row.teacher
                ? {
                      id: Number(row.teacher.id),
                      full_name: row.teacher.full_name ?? null,
                      email: row.teacher.email ?? null,
                  }
                : null,
            category: row.category
                ? {
                      id: Number(row.category.id),
                      slug: row.category.slug,
                      title_kz,
                  }
                : null,
            image_cover: row.image_cover ?? '',
            thumbnail: row.thumbnail ?? '',
            capacity: row.capacity == null ? null : Number(row.capacity),
            certificate: !!row.certificate,
            is_paid: !!row.is_paid,
            pricing:
                row.is_paid && Array.isArray(row.prices) && row.prices.length > 0
                    ? {
                          price: String(row.prices[0].price),
                          access_days: Number(row.prices[0].access_days),
                      }
                    : null,
            start_date: row.start_date == null ? null : Number(row.start_date),
            duration: row.duration == null ? null : Number(row.duration),
            position: row.position == null ? null : Number(row.position),
            created_at: Number(row.created_at),
            updated_at: row.updated_at == null ? null : Number(row.updated_at),
            deleted_at: row.deleted_at == null ? null : Number(row.deleted_at),
            translations,
            translation_completeness: completeness.translation_completeness,
            missing_locales: completeness.missing_locales,
            chapters,
            counts: {
                chapter_count: row._count?.chapters ?? 0,
                item_count: itemIds.length,
                schedule_count,
            },
        };
    }
}
