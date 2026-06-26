import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { ScopeActor } from '../../common/scoping/scope.types';
import type { CourseDetailDto, ChapterDto, ChapterItemDto, TranslationRowDto } from './dto/course-detail.dto';
import { deriveTranslationCompleteness } from './utils/translation-completeness';
import { CoursesCacheService } from './utils/courses-cache.service';
import { buildCourseDetailCacheKey } from './utils/course-cache';
import { itemTypeToRestrictionKind, loadAllowedGroupsByNode, nodeKey, type NodeKey } from './utils/access-restrictions';

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
 *        curator / others → allowed — governed by @RequirePermission on the controller
 *                            (no blanket role denial; only teacher is narrowed to own).
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
        // teacher is narrowed to own courses (per-tenant ownership); admin, curator and
        // any other admitted role pass — governed by @RequirePermission on the controller.
        if (actor.role_name === 'teacher' && Number(exists.teacher_id) !== actor.id) {
            throw new ForbiddenException('courses.forbidden_scope');
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
                strict_progress: true,
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
                                is_required: true,
                                // Phase 20 — per-item access gate, applies to all types.
                                accessibility: true,
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

        // Hydrate file / quiz / assignment refs in 3 batched queries (no N+1).
        // WebinarChapterItem.item_id is a polymorphic FK — there is no Prisma relation,
        // so we group ids by type and run one query per ref type.
        const fileItemIds = new Set<number>();
        const quizItemIds = new Set<number>();
        const assignmentItemIds = new Set<number>();
        for (const c of row.chapters as any[]) {
            for (const it of c.items as any[]) {
                const refId = Number(it.item_id);
                if (it.type === 'file') fileItemIds.add(refId);
                else if (it.type === 'quiz') quizItemIds.add(refId);
                else if (it.type === 'assignment') assignmentItemIds.add(refId);
            }
        }

        const [files, quizzes, assignments] = await Promise.all([
            fileItemIds.size === 0
                ? Promise.resolve([] as any[])
                : this.prisma.files.findMany({
                      where: { id: { in: Array.from(fileItemIds) } },
                      select: {
                          id: true,
                          file_type: true,
                          storage: true,
                          file: true,
                          volume: true,
                          accessibility: true,
                          translations: {
                              where: { locale: 'kz' },
                              select: { locale: true, title: true, description: true },
                              take: 1,
                          },
                      },
                  }),
            quizItemIds.size === 0
                ? Promise.resolve([] as any[])
                : this.prisma.quizzes.findMany({
                      where: { id: { in: Array.from(quizItemIds) } },
                      select: {
                          id: true,
                          translations: {
                              where: { locale: 'kz' },
                              select: { title: true },
                              take: 1,
                          },
                      },
                  }),
            assignmentItemIds.size === 0
                ? Promise.resolve([] as any[])
                : this.prisma.webinarAssignment.findMany({
                      where: { id: { in: Array.from(assignmentItemIds) } },
                      select: {
                          id: true,
                          translations: {
                              where: { locale: 'kz' },
                              select: { title: true },
                              take: 1,
                          },
                      },
                  }),
        ]);

        const fileById = new Map<number, any>((files as any[]).map((f) => [Number(f.id), f]));
        const quizById = new Map<number, any>((quizzes as any[]).map((q) => [Number(q.id), q]));
        const assignmentById = new Map<number, any>(
            (assignments as any[]).map((a) => [Number(a.id), a]),
        );

        // Phase 29 — multi-file PDF blocks: one batched bridge query for all items.
        const pdfRows =
            itemIds.length === 0
                ? ([] as any[])
                : await this.prisma.webinarChapterItemPdfFile.findMany({
                      where: { webinar_chapter_item_id: { in: itemIds } },
                      orderBy: { sort_order: 'asc' },
                      select: {
                          webinar_chapter_item_id: true,
                          file: {
                              select: {
                                  id: true,
                                  file: true,
                                  volume: true,
                                  translations: { where: { locale: 'kz' }, select: { title: true }, take: 1 },
                              },
                          },
                      },
                  });
        const pdfsByItem = new Map<number, ChapterItemDto['pdfs']>();
        for (const r of pdfRows as any[]) {
            if (!r.file) continue;
            const list = pdfsByItem.get(Number(r.webinar_chapter_item_id)) ?? [];
            list.push({
                id: Number(r.file.id),
                file: r.file.file,
                volume: r.file.volume,
                title: r.file.translations?.[0]?.title ?? '',
            });
            pdfsByItem.set(Number(r.webinar_chapter_item_id), list);
        }

        // Phase 30 — lecture-notes attachments: one batched bridge query for all items.
        const attachmentRows =
            itemIds.length === 0
                ? ([] as any[])
                : await this.prisma.webinarChapterItemAttachment.findMany({
                      where: { webinar_chapter_item_id: { in: itemIds } },
                      orderBy: { sort_order: 'asc' },
                      select: {
                          webinar_chapter_item_id: true,
                          file: {
                              select: {
                                  id: true,
                                  file: true,
                                  file_type: true,
                                  volume: true,
                                  translations: { where: { locale: 'kz' }, select: { title: true }, take: 1 },
                              },
                          },
                      },
                  });
        const attachmentsByItem = new Map<number, ChapterItemDto['attachments']>();
        for (const r of attachmentRows as any[]) {
            if (!r.file) continue;
            const list = attachmentsByItem.get(Number(r.webinar_chapter_item_id)) ?? [];
            list.push({
                id: Number(r.file.id),
                file: r.file.file,
                file_type: r.file.file_type,
                volume: r.file.volume,
                title: r.file.translations?.[0]?.title ?? '',
            });
            attachmentsByItem.set(Number(r.webinar_chapter_item_id), list);
        }

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

        // Phase 33 — load the group whitelist for every module + lesson node so the
        // detail payload carries `allowed_group_ids` (lesson editor + schedule-grid
        // indicator). One batched query keyed by (kind, ref_id).
        const restrictionKeys: NodeKey[] = [];
        for (const c of row.chapters as any[]) {
            restrictionKeys.push({ kind: 'lesson', ref_id: Number(c.id) });
            for (const it of c.items as any[]) {
                restrictionKeys.push({ kind: itemTypeToRestrictionKind(it.type), ref_id: Number(it.item_id) });
            }
        }
        const allowedByNode = await loadAllowedGroupsByNode(this.prisma, restrictionKeys);

        // Chapters + items.
        const chapters: ChapterDto[] = (row.chapters as any[]).map((c: any) => {
            const cTranslations: TranslationRowDto[] = (c.translations ?? [])
                .filter((t: any) => t.locale === 'kz')
                .map((t: any) => ({
                    locale: 'kz' as const,
                    title: t.title,
                    description: null, // schema has no description column on chapter translations
                }));

            const items: ChapterItemDto[] = (c.items as any[]).map((it: any) => {
                const refId = Number(it.item_id);
                let file: ChapterItemDto['file'] = null;
                let quiz: ChapterItemDto['quiz'] = null;
                let assignment: ChapterItemDto['assignment'] = null;
                let itTranslations: TranslationRowDto[] = [];

                if (it.type === 'file') {
                    const f = fileById.get(refId);
                    if (f) {
                        file = {
                            id: Number(f.id),
                            file_type: f.file_type,
                            storage: f.storage,
                            file: f.file,
                            volume: f.volume,
                            accessibility: f.accessibility,
                        };
                        itTranslations = (f.translations ?? []).map((t: any) => ({
                            locale: 'kz' as const,
                            title: t.title,
                            description: t.description ?? null,
                        }));
                    }
                } else if (it.type === 'quiz') {
                    const q = quizById.get(refId);
                    if (q) {
                        // Quizzes has no slug column — surface KZ translation title as label proxy.
                        quiz = { id: Number(q.id), slug: q.translations?.[0]?.title ?? '' };
                    }
                } else if (it.type === 'assignment') {
                    const a = assignmentById.get(refId);
                    if (a) {
                        assignment = {
                            id: Number(a.id),
                            title: a.translations?.[0]?.title ?? '',
                        };
                    }
                }

                return {
                    id: Number(it.id),
                    type: it.type as 'file' | 'quiz' | 'assignment',
                    order: it.order == null ? null : Number(it.order),
                    item_id: refId,
                    is_required: it.is_required !== false,
                    accessibility: (it.accessibility ?? 'free') as 'free' | 'paid',
                    file,
                    quiz,
                    assignment,
                    pdfs: pdfsByItem.get(Number(it.id)) ?? [],
                    attachments: attachmentsByItem.get(Number(it.id)) ?? [],
                    translations: itTranslations,
                    allowed_group_ids:
                        allowedByNode.get(nodeKey(itemTypeToRestrictionKind(it.type), refId)) ?? [],
                };
            });

            return {
                id: Number(c.id),
                order: c.order == null ? null : Number(c.order),
                status: c.status as 'active' | 'inactive',
                translations: cTranslations,
                items,
                allowed_group_ids: allowedByNode.get(nodeKey('lesson', Number(c.id))) ?? [],
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
            strict_progress: !!row.strict_progress,
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
