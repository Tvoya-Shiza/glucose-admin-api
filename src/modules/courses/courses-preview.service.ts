import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { ScopeActor } from '../../common/scoping/scope.types';
import type {
    CoursePreviewResponseDto,
    PreviewChapter,
    PreviewChapterItem,
    PreviewFileRef,
    PreviewFileTranslation,
    PreviewTranslationRow,
} from './dto/preview.dto';
import type { ChapterItemType, ChapterStatus, CourseType } from './dto/course-detail.dto';
import type { CourseStatusFilter } from './dto/list-courses.dto';
import type { Locale } from './dto/translation.dto';

/**
 * CRS-09 — preview-as-student service (Plan 07).
 *
 * GET /admin-api/v1/admin/courses/:id/preview?group_id=
 *
 * READ-ONLY MIRROR — NOT impersonation:
 *   - Admin's session stays admin throughout the call. NO Set-Cookie, NO fake JWT,
 *     NO admin -> student session swap. The admin-client's PreviewRenderer surfaces
 *     a banner ("Preview as student — no real session is changed") to remove any
 *     ambiguity.
 *   - We just read the same content the student app's content endpoint would and
 *     compute "what would student see" visibility flags per item.
 *
 * SCOPE GATE (3-step assertScope, identical shape to courses-detail.service):
 *   1. Existence: prisma.webinar.findFirst({ id, deleted_at: null }) -> 404 on null.
 *   2. Scope check on the loaded row:
 *        admin            -> always allowed
 *        teacher (own)    -> allowed iff teacher_id === actor.id
 *        teacher (other)  -> 403 'courses.forbidden_scope'
 *        curator          -> EXCLUDED at the controller @Roles surface; never reaches here.
 *                            Defensive: if a future internal call passes curator, throws 403.
 *   3. Re-read with full select shape.
 *
 * SCHEDULE-APPLICATION ALGORITHM (mirror of student-app semantics):
 *
 *   For each WebinarChapterItem in the course tree:
 *
 *     when ?group_id was provided:
 *       Look up WebinarChapterSchedule WHERE
 *         group_id = req.group_id AND webinar_chapter_item_id = item.id.
 *
 *       If a schedule row exists:
 *         visible_now := (now >= start_date) AND (now <= end_date)
 *         schedule_window := { start_date, end_date, is_before_start, expiration_check }
 *
 *       If NO schedule row exists for the (group_id, item) pair:
 *         visible_now := false
 *         schedule_window := null
 *         (Operationally: "not yet scheduled for this group" — same posture the student
 *         app applies. The PreviewRenderer surfaces a "not visible" placeholder.)
 *
 *     when ?group_id was omitted (admin see-everything):
 *       visible_now := true (always)
 *       schedule_window := null
 *
 *   Cross-reference: the canonical algorithm lives in glucose-api's student-facing course
 *   content endpoint — admin and student MUST stay in lockstep here. When student-app
 *   semantics evolve (e.g. is_before_start affects visibility differently), this service
 *   has to mirror the change. Echo `is_before_start` + `expiration_check` so the UI can
 *   render student-equivalent banners regardless of the visibility outcome.
 *
 * NO CACHE: preview is computationally cheap (already-cached schedule data + a single
 * findFirst+items+files join) and the `now` parameter changes second-by-second. Caching
 * would force key churn that defeats the purpose; skip.
 *
 * NO AUDIT: GET endpoint. Audit-exempt by project policy (same posture as
 * courses-detail.controller GET). Per CONTEXT D-26 the rule is "every mutation carries
 * @Audit" — preview is read-only.
 */
@Injectable()
export class CoursesPreviewService {
    private readonly logger = new Logger(CoursesPreviewService.name);

    constructor(private readonly prisma: PrismaService) {}

    public async getPreview(
        actor: ScopeActor,
        courseId: number,
        groupId: number | undefined,
    ): Promise<CoursePreviewResponseDto> {
        // Step 1: existence check WITHOUT scope spread.
        const exists: any = await this.prisma.webinar.findFirst({
            where: { id: courseId, deleted_at: null },
            select: { id: true, teacher_id: true },
        });
        if (!exists) {
            throw new NotFoundException('courses.not_found');
        }

        // Step 2: scope check on the loaded row.
        // admin always passes; teacher must own the course; curator (and any other role)
        // is default-deny. Controller @Roles already excludes curator at the surface;
        // this assertion is defense in depth for future internal call sites.
        if (actor.role_name !== 'admin') {
            const allowed =
                actor.role_name === 'teacher' && Number(exists.teacher_id) === actor.id;
            if (!allowed) {
                throw new ForbiddenException('courses.forbidden_scope');
            }
        }

        // Validate group when provided. T-05-74 mitigation — schedule lookups are
        // filtered to the requested group_id only; existence-check first prevents
        // a "no schedules + visible_now=false on every item" surface from being
        // mistaken for "schedule exists but empty".
        let groupContext: { id: number; name: string } | null = null;
        if (groupId !== undefined) {
            const g: any = await this.prisma.group.findFirst({
                where: { id: groupId },
                select: { id: true, name: true },
            });
            if (!g) {
                throw new NotFoundException('preview.group_not_found');
            }
            groupContext = { id: Number(g.id), name: g.name };
        }

        // Step 3: re-read with full select (mirror detail service, plus Files join for
        // type='file' items so the renderer doesn't need an extra round-trip).
        const row: any = await this.prisma.webinar.findFirst({
            where: { id: courseId, deleted_at: null },
            select: {
                id: true,
                slug: true,
                type: true,
                status: true,
                image_cover: true,
                thumbnail: true,
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
                            },
                            orderBy: [{ order: 'asc' }, { id: 'asc' }],
                        },
                    },
                    orderBy: [{ order: 'asc' }, { id: 'asc' }],
                },
            },
        });

        // Race window between step 1 (existence) and this re-read: a concurrent soft-delete
        // could have landed. Defensive 404.
        if (!row) {
            throw new NotFoundException('courses.not_found');
        }

        // Hydrate Files for type='file' items in one batched query (no N+1).
        const fileItemIds: number[] = (row.chapters as any[]).flatMap((c: any) =>
            (c.items as any[]).filter((i: any) => i.type === 'file').map((i: any) => Number(i.item_id)),
        );
        const files: any[] =
            fileItemIds.length > 0
                ? await this.prisma.files.findMany({
                      where: { id: { in: fileItemIds } },
                      select: {
                          id: true,
                          file: true,
                          file_type: true,
                          volume: true,
                          translations: {
                              select: { locale: true, title: true, description: true },
                          },
                      },
                  })
                : [];
        const fileMap = new Map<number, any>(files.map((f: any) => [Number(f.id), f]));

        // Build the (item_id -> schedule) map for the requested group, in one batched query.
        const scheduleMap = new Map<
            number,
            {
                start_date: number;
                end_date: number;
                is_before_start: boolean;
                expiration_check: boolean;
            }
        >();
        if (groupId !== undefined) {
            const allItemIds: number[] = (row.chapters as any[]).flatMap((c: any) =>
                (c.items as any[]).map((i: any) => Number(i.id)),
            );
            if (allItemIds.length > 0) {
                const schedules: any[] = await this.prisma.webinarChapterSchedule.findMany({
                    where: {
                        group_id: groupId,
                        webinar_chapter_item_id: { in: allItemIds },
                    },
                    select: {
                        webinar_chapter_item_id: true,
                        start_date: true,
                        end_date: true,
                        is_before_start: true,
                        expiration_check: true,
                    },
                });
                for (const s of schedules) {
                    scheduleMap.set(Number(s.webinar_chapter_item_id), {
                        start_date: Number(s.start_date),
                        end_date: Number(s.end_date),
                        is_before_start: !!s.is_before_start,
                        expiration_check: !!s.expiration_check,
                    });
                }
            }
        }

        const now = Math.floor(Date.now() / 1000);

        const visibleNow = (itemId: number): { visible_now: boolean; window: typeof scheduleMap extends Map<any, infer V> ? V | null : never } => {
            if (groupId === undefined) {
                return { visible_now: true, window: null as any };
            }
            const s = scheduleMap.get(itemId);
            if (!s) {
                return { visible_now: false, window: null as any };
            }
            return {
                visible_now: now >= s.start_date && now <= s.end_date,
                window: s as any,
            };
        };

        // Top-level translations.
        const translations: PreviewTranslationRow[] = (row.translations ?? [])
            .filter((t: any) => t.locale === 'ru' || t.locale === 'kz')
            .map((t: any) => ({
                locale: t.locale as Locale,
                title: t.title,
                description: t.description ?? null,
            }));

        // Chapters + items.
        const chapters: PreviewChapter[] = (row.chapters as any[]).map((c: any) => {
            const cTranslations = (c.translations ?? [])
                .filter((t: any) => t.locale === 'ru' || t.locale === 'kz')
                .map((t: any) => ({ locale: t.locale as Locale, title: t.title }));

            const items: PreviewChapterItem[] = (c.items as any[]).map((it: any) => {
                const itemId = Number(it.id);
                const itemKind = it.type as ChapterItemType;
                const refId = Number(it.item_id);

                const { visible_now, window } = visibleNow(itemId);

                let fileRef: PreviewFileRef | null = null;
                if (itemKind === 'file') {
                    const f = fileMap.get(refId);
                    if (f) {
                        const fTranslations: PreviewFileTranslation[] = (f.translations ?? [])
                            .filter(
                                (t: any) => t.locale === 'ru' || t.locale === 'kz',
                            )
                            .map((t: any) => ({
                                locale: t.locale as Locale,
                                title: t.title,
                                description: t.description ?? null,
                            }));
                        fileRef = {
                            id: Number(f.id),
                            file: f.file,
                            file_type: f.file_type,
                            volume: f.volume,
                            translations: fTranslations,
                        };
                    }
                }

                return {
                    id: itemId,
                    type: itemKind,
                    order: it.order == null ? null : Number(it.order),
                    item_id: refId,
                    visible_now,
                    schedule_window: window,
                    file: fileRef,
                    quiz: itemKind === 'quiz' ? { id: refId } : null,
                    assignment: itemKind === 'assignment' ? { id: refId } : null,
                };
            });

            return {
                id: Number(c.id),
                order: c.order == null ? null : Number(c.order),
                status: c.status as ChapterStatus,
                translations: cTranslations,
                items,
            };
        });

        return {
            id: Number(row.id),
            slug: row.slug,
            type: row.type as CourseType,
            status: row.status as CourseStatusFilter,
            image_cover: row.image_cover ?? '',
            thumbnail: row.thumbnail ?? '',
            translations,
            chapters,
            group_context: groupContext,
            now,
        };
    }
}
