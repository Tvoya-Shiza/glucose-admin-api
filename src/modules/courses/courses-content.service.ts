import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { ScopeActor } from '../../common/scoping/scope.types';
import type { CourseDetailDto, ChapterDto, ChapterItemDto } from './dto/course-detail.dto';
import { ReorderDto } from './dto/reorder.dto';
import { UpsertChapterDto, UpsertItemDto } from './dto/upsert-item.dto';
import { CoursesDetailService } from './courses-detail.service';
import { CoursesCacheService } from './utils/courses-cache.service';
import { COURSES_INVALIDATE_PATTERN } from './utils/course-cache';
import { sanitizeTiptapHtmlServer } from './utils/sanitize-html-server';

/**
 * CRS-03 + CRS-04 — content tree (chapter + item) editor service (Plan 05).
 *
 * Endpoints (controller):
 *   PATCH  /admin-api/v1/admin/courses/:id/reorder
 *   POST   /admin-api/v1/admin/courses/:id/chapters
 *   PATCH  /admin-api/v1/admin/courses/:id/chapters/:chapterId
 *   DELETE /admin-api/v1/admin/courses/:id/chapters/:chapterId
 *   POST   /admin-api/v1/admin/courses/:id/items
 *   PATCH  /admin-api/v1/admin/courses/:id/items/:itemId
 *   DELETE /admin-api/v1/admin/courses/:id/items/:itemId
 *
 * Pattern carry-overs from Plan 02/03:
 *   - 3-step assertScope (existence -> teacher gate -> proceed). Inlined here rather
 *     than imported from CoursesMutationsService (mutations service's helper is private).
 *     Duplication intentional — keeps the gate audit-trail readable per service.
 *   - Cache invalidation: COURSES_INVALIDATE_PATTERN on every write (CONTEXT D-25).
 *   - All multi-step writes wrapped in prisma.$transaction.
 *
 * Schema-truth resolutions (locked Plan 01, applied here):
 *   - WebinarChapterItem.type = file | quiz | assignment.
 *     Sub-types (rich-text / image / video) are file-row variants:
 *       text/html      → Tiptap HTML in FileTranslations.description per locale
 *       image/* | video/* → Files.file holds the uploaded URL
 *   - Per-locale Tiptap content lives in FileTranslations.description (LongText).
 *     Sanitized server-side via sanitizeTiptapHtmlServer (T-05-30 — final gate).
 *   - Chapter translations: WebinarChapterTranslation has only `title` (no description).
 *   - No @@unique on (file_id, locale) or (webinar_chapter_id, locale) — service uses
 *     find-then-update / find-then-create.
 *   - Cascade: WebinarChapterItem.chapter_id has onDelete: Cascade — chapter delete
 *     wipes items automatically (no manual cleanup needed).
 *
 * Reorder algorithm (D-07/D-08):
 *   1. Pre-flight every chapter id ∈ {webinar_id: courseId}
 *   2. Pre-flight every item id ∈ {chapter.webinar_id: courseId}
 *   3. Pre-flight every target chapter_id (for inter-chapter moves) ∈ this course
 *   4. Apply all updates inside one $transaction
 *   5. Return refreshed CourseDetailDto (re-uses CoursesDetailService.getDetail —
 *      cache invalidation triggers a fresh read).
 *
 * TOCTOU defense (T-05-44): pre-flight findMany inside the same actor's request scope;
 * a concurrent move that breaks invariants is caught at step 1-3 and the reorder is
 * rejected with 400 (admin-client refetches and replays).
 */
@Injectable()
export class CoursesContentService {
    private readonly logger = new Logger(CoursesContentService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly cache: CoursesCacheService,
        private readonly detailService: CoursesDetailService,
    ) {}

    // ---------------------------------------------------------------------
    // Scope gate
    // ---------------------------------------------------------------------

    /**
     * 3-step assert: existence -> teacher gate -> proceed. Returns the loaded row.
     * Exposed `public` so the controller's existence check can be a single round-trip.
     */
    public async assertCourseScope(
        actor: ScopeActor,
        courseId: number,
    ): Promise<{ id: number; teacher_id: number }> {
        const existing: any = await this.prisma.webinar.findFirst({
            where: { id: courseId, deleted_at: null },
            select: { id: true, teacher_id: true },
        });
        if (!existing) {
            throw new NotFoundException('courses.not_found');
        }
        if (actor.role_name !== 'admin') {
            const allowed = actor.role_name === 'teacher' && Number(existing.teacher_id) === actor.id;
            if (!allowed) {
                throw new ForbiddenException('courses.forbidden_scope');
            }
        }
        return { id: Number(existing.id), teacher_id: Number(existing.teacher_id) };
    }

    // ---------------------------------------------------------------------
    // Reorder
    // ---------------------------------------------------------------------

    public async reorder(actor: ScopeActor, courseId: number, dto: ReorderDto): Promise<CourseDetailDto> {
        await this.assertCourseScope(actor, courseId);

        const chapters = dto.chapters ?? [];
        const items = dto.items ?? [];
        if (chapters.length === 0 && items.length === 0) {
            throw new BadRequestException('reorder.empty_payload');
        }

        // Pre-flight (1): every chapter id belongs to this course.
        if (chapters.length > 0) {
            const ids = chapters.map((c) => c.id);
            const found: any[] = await this.prisma.webinarChapter.findMany({
                where: { id: { in: ids }, webinar_id: courseId },
                select: { id: true },
            });
            if (found.length !== ids.length) {
                throw new BadRequestException('reorder.chapter_id_not_in_course');
            }
        }

        // Pre-flight (2): every item id belongs to this course (joined via chapter).
        if (items.length > 0) {
            const ids = items.map((i) => i.id);
            const found: any[] = await this.prisma.webinarChapterItem.findMany({
                where: { id: { in: ids }, webinar_chapter: { webinar_id: courseId } },
                select: { id: true },
            });
            if (found.length !== ids.length) {
                throw new BadRequestException('reorder.item_id_not_in_course');
            }

            // Pre-flight (3): every distinct target chapter_id belongs to this course
            // (defends inter-chapter moves where active chapter is foreign — T-05-45).
            const targetChapterIds = Array.from(new Set(items.map((i) => i.chapter_id)));
            const validTargets: any[] = await this.prisma.webinarChapter.findMany({
                where: { id: { in: targetChapterIds }, webinar_id: courseId },
                select: { id: true },
            });
            if (validTargets.length !== targetChapterIds.length) {
                throw new BadRequestException('reorder.target_chapter_not_in_course');
            }
        }

        // Apply all updates inside ONE $transaction (single commit boundary — D-08).
        await this.prisma.$transaction([
            ...chapters.map((c) =>
                this.prisma.webinarChapter.update({
                    where: { id: c.id },
                    data: { order: c.order, updated_at: nowSeconds() },
                }),
            ),
            ...items.map((i) =>
                this.prisma.webinarChapterItem.update({
                    where: { id: i.id },
                    data: { order: i.order, chapter_id: i.chapter_id },
                }),
            ),
        ]);

        await this.cache.invalidate(COURSES_INVALIDATE_PATTERN);
        return this.detailService.getDetail(actor, courseId);
    }

    // ---------------------------------------------------------------------
    // Chapter CRUD
    // ---------------------------------------------------------------------

    public async upsertChapter(
        actor: ScopeActor,
        courseId: number,
        dto: UpsertChapterDto,
        chapterId?: number,
    ): Promise<ChapterDto> {
        await this.assertCourseScope(actor, courseId);

        // If updating, validate the chapter belongs to this course.
        if (chapterId) {
            const owned: any = await this.prisma.webinarChapter.findFirst({
                where: { id: chapterId, webinar_id: courseId },
                select: { id: true },
            });
            if (!owned) {
                throw new NotFoundException('chapters.not_in_course');
            }
        }

        const now = nowSeconds();
        const result: any = await this.prisma.$transaction(async (tx) => {
            let chapId: number;
            if (chapterId) {
                const data: Record<string, unknown> = { updated_at: now };
                if (typeof dto.order === 'number') data.order = dto.order;
                if (typeof dto.status === 'string') data.status = dto.status;
                await tx.webinarChapter.update({ where: { id: chapterId }, data });
                chapId = chapterId;
            } else {
                // Auto-assign next order if not provided (max(order)+1 within course).
                let nextOrder = dto.order;
                if (typeof nextOrder !== 'number') {
                    const maxRow: any = await tx.webinarChapter.findFirst({
                        where: { webinar_id: courseId },
                        select: { order: true },
                        orderBy: { order: 'desc' },
                    });
                    nextOrder = ((maxRow?.order as number | null) ?? 0) + 1;
                }
                const created: any = await tx.webinarChapter.create({
                    data: {
                        user_id: actor.id,
                        webinar_id: courseId,
                        order: nextOrder,
                        status: dto.status ?? 'active',
                        created_at: now,
                    },
                    select: { id: true },
                });
                chapId = Number(created.id);
            }

            // Translations upsert per locale (find-then-update; no @@unique).
            // Schema has TITLE only — TranslationDto.description is dropped.
            if (dto.translations && dto.translations.length > 0) {
                for (const t of dto.translations) {
                    if (t.locale !== 'ru' && t.locale !== 'kz') continue;
                    const existing: any = await tx.webinarChapterTranslation.findFirst({
                        where: { webinar_chapter_id: chapId, locale: t.locale },
                        select: { id: true },
                        orderBy: { id: 'asc' },
                    });
                    if (existing) {
                        await tx.webinarChapterTranslation.update({
                            where: { id: existing.id },
                            data: { title: t.title },
                        });
                    } else {
                        await tx.webinarChapterTranslation.create({
                            data: {
                                webinar_chapter_id: chapId,
                                locale: t.locale,
                                title: t.title,
                            },
                        });
                    }
                }
            }

            return this.readChapterDto(tx as any, chapId);
        });

        await this.cache.invalidate(COURSES_INVALIDATE_PATTERN);
        return result;
    }

    public async deleteChapter(
        actor: ScopeActor,
        courseId: number,
        chapterId: number,
    ): Promise<{ id: number; deleted: true }> {
        await this.assertCourseScope(actor, courseId);
        const owned: any = await this.prisma.webinarChapter.findFirst({
            where: { id: chapterId, webinar_id: courseId },
            select: { id: true },
        });
        if (!owned) {
            throw new NotFoundException('chapters.not_in_course');
        }
        // Items cascade via FK onDelete: Cascade. Translations also cascade.
        await this.prisma.webinarChapter.delete({ where: { id: chapterId } });
        await this.cache.invalidate(COURSES_INVALIDATE_PATTERN);
        return { id: chapterId, deleted: true };
    }

    // ---------------------------------------------------------------------
    // Item CRUD
    // ---------------------------------------------------------------------

    public async upsertItem(
        actor: ScopeActor,
        courseId: number,
        dto: UpsertItemDto & {
            file_url?: string;
            file_type?: string;
            volume?: string | number;
        },
        itemId?: number,
    ): Promise<ChapterItemDto> {
        await this.assertCourseScope(actor, courseId);

        // Validate target chapter belongs to course.
        const chapter: any = await this.prisma.webinarChapter.findFirst({
            where: { id: dto.chapter_id, webinar_id: courseId },
            select: { id: true },
        });
        if (!chapter) {
            throw new NotFoundException('items.chapter_not_in_course');
        }

        // If updating, validate item belongs to this course.
        if (itemId) {
            const owned: any = await this.prisma.webinarChapterItem.findFirst({
                where: { id: itemId, webinar_chapter: { webinar_id: courseId } },
                select: { id: true },
            });
            if (!owned) {
                throw new NotFoundException('items.not_in_course');
            }
        }

        const now = nowSeconds();
        const result: any = await this.prisma.$transaction(async (tx) => {
            let fileId: number = dto.item_id;
            let chapterItemId: number | undefined = itemId;

            if (dto.type === 'file') {
                if (!fileId || fileId === 0) {
                    // Create a fresh Files row. For rich-text-only items, file='' / file_type='text/html' / volume='0'.
                    const file: any = await tx.files.create({
                        data: {
                            creator_id: actor.id,
                            webinar_id: courseId,
                            chapter_id: dto.chapter_id,
                            storage: 'upload',
                            file: dto.file_url ?? '',
                            file_type: dto.file_type ?? 'text/html',
                            volume: String(dto.volume ?? '0'),
                            accessibility: 'free',
                            status: 'active',
                            created_at: now,
                        },
                        select: { id: true },
                    });
                    fileId = Number(file.id);
                } else {
                    // Validate the existing Files row belongs to this chapter (T-05-47 — orphan re-pointing).
                    const existingFile: any = await tx.files.findFirst({
                        where: { id: fileId },
                        select: { id: true, chapter_id: true },
                    });
                    if (!existingFile) {
                        throw new NotFoundException('items.file_not_found');
                    }
                    if (existingFile.chapter_id !== null && existingFile.chapter_id !== dto.chapter_id) {
                        throw new BadRequestException('items.file_not_in_chapter');
                    }
                    // Optionally update mutable Files fields if provided.
                    const fileData: Record<string, unknown> = {};
                    if (dto.file_url !== undefined) fileData.file = dto.file_url;
                    if (dto.file_type !== undefined) fileData.file_type = dto.file_type;
                    if (dto.volume !== undefined) fileData.volume = String(dto.volume);
                    if (Object.keys(fileData).length > 0) {
                        fileData.updated_at = now;
                        await tx.files.update({ where: { id: fileId }, data: fileData });
                    }
                    // Re-point Files.chapter_id if it was null (legacy rows can lack it).
                    if (existingFile.chapter_id === null) {
                        await tx.files.update({
                            where: { id: fileId },
                            data: { chapter_id: dto.chapter_id, webinar_id: courseId },
                        });
                    }
                }

                // Upsert FileTranslations per locale — sanitize description SERVER-SIDE (T-05-30).
                if (dto.translations && dto.translations.length > 0) {
                    for (const t of dto.translations) {
                        if (t.locale !== 'ru' && t.locale !== 'kz') continue;
                        const sanitizedDesc = sanitizeTiptapHtmlServer(t.description ?? '');
                        const existing: any = await tx.fileTranslations.findFirst({
                            where: { file_id: fileId, locale: t.locale },
                            select: { id: true },
                            orderBy: { id: 'asc' },
                        });
                        if (existing) {
                            await tx.fileTranslations.update({
                                where: { id: existing.id },
                                data: { title: t.title, description: sanitizedDesc },
                            });
                        } else {
                            await tx.fileTranslations.create({
                                data: {
                                    file_id: fileId,
                                    locale: t.locale,
                                    title: t.title,
                                    description: sanitizedDesc,
                                },
                            });
                        }
                    }
                }
            } else if (dto.type === 'quiz') {
                const q: any = await tx.quizzes.findFirst({
                    where: { id: dto.item_id },
                    select: { id: true },
                });
                if (!q) {
                    throw new NotFoundException('items.quiz_not_found');
                }
                fileId = dto.item_id;
            } else if (dto.type === 'assignment') {
                const a: any = await tx.webinarAssignment.findFirst({
                    where: { id: dto.item_id, webinar_id: courseId },
                    select: { id: true },
                });
                if (!a) {
                    throw new NotFoundException('items.assignment_not_found');
                }
                fileId = dto.item_id;
            }

            // Create or update WebinarChapterItem.
            if (chapterItemId) {
                const data: Record<string, unknown> = {
                    type: dto.type,
                    item_id: fileId,
                    chapter_id: dto.chapter_id,
                };
                if (typeof dto.order === 'number') data.order = dto.order;
                await tx.webinarChapterItem.update({ where: { id: chapterItemId }, data });
            } else {
                // Auto-assign order if not provided.
                let nextOrder = dto.order;
                if (typeof nextOrder !== 'number') {
                    const maxRow: any = await tx.webinarChapterItem.findFirst({
                        where: { chapter_id: dto.chapter_id },
                        select: { order: true },
                        orderBy: { order: 'desc' },
                    });
                    nextOrder = ((maxRow?.order as number | null) ?? 0) + 1;
                }
                const created: any = await tx.webinarChapterItem.create({
                    data: {
                        user_id: actor.id,
                        chapter_id: dto.chapter_id,
                        type: dto.type,
                        item_id: fileId,
                        order: nextOrder,
                        created_at: now,
                    },
                    select: { id: true },
                });
                chapterItemId = Number(created.id);
            }

            return this.readItemDto(tx as any, chapterItemId);
        });

        await this.cache.invalidate(COURSES_INVALIDATE_PATTERN);
        return result;
    }

    public async deleteItem(
        actor: ScopeActor,
        courseId: number,
        itemId: number,
    ): Promise<{ id: number; deleted: true }> {
        await this.assertCourseScope(actor, courseId);
        const owned: any = await this.prisma.webinarChapterItem.findFirst({
            where: { id: itemId, webinar_chapter: { webinar_id: courseId } },
            select: { id: true },
        });
        if (!owned) {
            throw new NotFoundException('items.not_in_course');
        }
        await this.prisma.webinarChapterItem.delete({ where: { id: itemId } });
        // Files row intentionally retained — Plan 06 covers item-level scheduling
        // cleanup. Re-using a Files row from another item would orphan-recover.
        await this.cache.invalidate(COURSES_INVALIDATE_PATTERN);
        return { id: itemId, deleted: true };
    }

    // ---------------------------------------------------------------------
    // Internal read helpers
    // ---------------------------------------------------------------------

    private async readChapterDto(tx: PrismaService, chapterId: number): Promise<ChapterDto> {
        const row: any = await tx.webinarChapter.findFirst({
            where: { id: chapterId },
            select: {
                id: true,
                order: true,
                status: true,
                translations: { select: { locale: true, title: true } },
                items: {
                    select: { id: true, type: true, order: true, item_id: true },
                    orderBy: [{ order: 'asc' }, { id: 'asc' }],
                },
            },
        });
        if (!row) throw new NotFoundException('chapters.not_in_course');

        return {
            id: Number(row.id),
            order: row.order == null ? null : Number(row.order),
            status: row.status,
            translations: (row.translations ?? [])
                .filter((t: any) => t.locale === 'ru' || t.locale === 'kz')
                .map((t: any) => ({
                    locale: t.locale as 'ru' | 'kz',
                    title: t.title,
                    description: null,
                })),
            items: (row.items ?? []).map((it: any) => ({
                id: Number(it.id),
                type: it.type,
                order: it.order == null ? null : Number(it.order),
                item_id: Number(it.item_id),
                file: null,
                quiz: null,
                assignment: null,
                translations: [],
            })),
        };
    }

    private async readItemDto(tx: PrismaService, itemId: number): Promise<ChapterItemDto> {
        const row: any = await tx.webinarChapterItem.findFirst({
            where: { id: itemId },
            select: { id: true, type: true, order: true, item_id: true },
        });
        if (!row) throw new NotFoundException('items.not_in_course');

        // Hydrate file / quiz / assignment ref + translations (only when type='file').
        let file: ChapterItemDto['file'] = null;
        let quiz: ChapterItemDto['quiz'] = null;
        let assignment: ChapterItemDto['assignment'] = null;
        let translations: ChapterItemDto['translations'] = [];

        if (row.type === 'file') {
            const f: any = await tx.files.findFirst({
                where: { id: Number(row.item_id) },
                select: {
                    id: true,
                    file_type: true,
                    storage: true,
                    file: true,
                    volume: true,
                    translations: { select: { locale: true, title: true, description: true } },
                },
            });
            if (f) {
                file = {
                    id: Number(f.id),
                    file_type: f.file_type,
                    storage: f.storage,
                    file: f.file,
                    volume: f.volume,
                };
                translations = (f.translations ?? [])
                    .filter((t: any) => t.locale === 'ru' || t.locale === 'kz')
                    .map((t: any) => ({
                        locale: t.locale as 'ru' | 'kz',
                        title: t.title,
                        description: t.description ?? null,
                    }));
            }
        } else if (row.type === 'quiz') {
            const q: any = await tx.quizzes.findFirst({
                where: { id: Number(row.item_id) },
                select: { id: true, translations: { select: { title: true } } },
            });
            if (q) {
                // Quizzes has no slug column — surface translation title as label proxy.
                quiz = { id: Number(q.id), slug: q.translations?.[0]?.title ?? '' };
            }
        } else if (row.type === 'assignment') {
            const a: any = await tx.webinarAssignment.findFirst({
                where: { id: Number(row.item_id) },
                select: { id: true },
            });
            if (a) {
                assignment = { id: Number(a.id) };
            }
        }

        return {
            id: Number(row.id),
            type: row.type,
            order: row.order == null ? null : Number(row.order),
            item_id: Number(row.item_id),
            file,
            quiz,
            assignment,
            translations,
        };
    }
}

function nowSeconds(): number {
    return Math.floor(Date.now() / 1000);
}
