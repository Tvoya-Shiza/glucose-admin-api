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
                    if (t.locale !== 'kz') continue;
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
            storage?: string;
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
        // Phase 29 — multi-file PDF block. When present, the item becomes a PDF
        // collection: one Files row per entry, linked via the bridge (ordered).
        const pdfInputs = dto.pdf_files;
        const isPdfBlock = dto.type === 'file' && Array.isArray(pdfInputs) && pdfInputs.length > 0;
        const result: any = await this.prisma.$transaction(async (tx) => {
            let fileId: number = dto.item_id;
            let chapterItemId: number | undefined = itemId;
            let pdfFileIds: number[] | null = null;

            if (isPdfBlock) {
                // Create one Files row per PDF (storage='upload', application/pdf).
                // Title rule: the PRIMARY (first) file carries the block title (so the
                // lesson label via pickTitle is meaningful); the rest use their own
                // uploaded filename. Falls back to the filename when no block title.
                const blockTitle = dto.translations?.find((t) => t.locale === 'kz')?.title?.trim() ?? '';
                const createdIds: number[] = [];
                for (let idx = 0; idx < pdfInputs!.length; idx++) {
                    const pdf = pdfInputs![idx];
                    const f: any = await tx.files.create({
                        data: {
                            creator_id: actor.id,
                            webinar_id: courseId,
                            chapter_id: dto.chapter_id,
                            storage: 'upload' as any,
                            file: pdf.file_url,
                            file_type: 'application/pdf',
                            volume: String(pdf.volume ?? '0'),
                            accessibility: dto.accessibility ?? 'free',
                            status: 'active',
                            created_at: now,
                        },
                        select: { id: true },
                    });
                    const newId = Number(f.id);
                    createdIds.push(newId);
                    const label = idx === 0 ? blockTitle || pdf.name : pdf.name;
                    if (label && label.trim()) {
                        await tx.fileTranslations.create({
                            data: { file_id: newId, locale: 'kz', title: label.slice(0, 255), description: null },
                        });
                    }
                }
                pdfFileIds = createdIds;
                fileId = createdIds[0]; // item_id points at the first pdf (back-compat).
            } else if (dto.type === 'file') {
                if (!fileId || fileId === 0) {
                    // Create a fresh Files row. For rich-text-only items, file='' / file_type='text/html' / volume='0'.
                    // For YouTube / Vimeo / external embeds the client passes storage='youtube'|'vimeo'|'iframe'
                    // so the user-API can render with the right player. Defaults to 'upload' for binary uploads.
                    const file: any = await tx.files.create({
                        data: {
                            creator_id: actor.id,
                            webinar_id: courseId,
                            chapter_id: dto.chapter_id,
                            storage: (dto.storage ?? 'upload') as any,
                            file: dto.file_url ?? '',
                            file_type: dto.file_type ?? 'text/html',
                            volume: String(dto.volume ?? '0'),
                            // Phase 13: content-level access toggle. Defaults to 'free' so the
                            // first lesson is reachable to non-purchased students out of the box.
                            accessibility: dto.accessibility ?? 'free',
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
                    if (dto.storage !== undefined) fileData.storage = dto.storage;
                    if (dto.accessibility !== undefined) fileData.accessibility = dto.accessibility;
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
                        if (t.locale !== 'kz') continue;
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
                // Assignments are creatable as standalone (webinar_id/chapter_id
                // nullable on schema). Accept either:
                //   1) An assignment already bound to THIS course (webinar_id=courseId).
                //   2) An unbound assignment (webinar_id IS NULL) — we back-fill the
                //      binding here so the student-side flow can derive course → purchase.
                const a: any = await tx.webinarAssignment.findFirst({
                    where: {
                        id: dto.item_id,
                        OR: [{ webinar_id: courseId }, { webinar_id: null }],
                    },
                    select: { id: true, webinar_id: true, chapter_id: true },
                });
                if (!a) {
                    throw new NotFoundException('items.assignment_not_found');
                }
                if (a.webinar_id == null || a.chapter_id == null) {
                    await tx.webinarAssignment.update({
                        where: { id: a.id },
                        data: { webinar_id: courseId, chapter_id: dto.chapter_id },
                    });
                }
                fileId = dto.item_id;
            }

            // Phase 30 — lecture-notes attachments (up to 3). Reconciled via the
            // attachment bridge after the item write. Tri-state from the DTO:
            //   undefined → leave as-is · [] → detach all · non-empty → replace.
            // One fresh Files row per entry (old rows orphaned, per Phase 29 policy).
            // NEVER touches item_id, so a video item keeps its video main file.
            let attachmentFileIds: number[] | undefined = undefined;
            if (dto.attachments !== undefined) {
                const created: number[] = [];
                for (const att of dto.attachments) {
                    const af: any = await tx.files.create({
                        data: {
                            creator_id: actor.id,
                            webinar_id: courseId,
                            chapter_id: dto.chapter_id,
                            storage: 'upload' as any,
                            file: att.file_url,
                            file_type: att.file_type,
                            volume: String(att.volume ?? '0'),
                            accessibility: dto.accessibility ?? 'free',
                            status: 'active',
                            created_at: now,
                        },
                        select: { id: true },
                    });
                    const newId = Number(af.id);
                    created.push(newId);
                    const attTitle = (att.name ?? '').slice(0, 255);
                    if (attTitle.trim()) {
                        await tx.fileTranslations.create({
                            data: { file_id: newId, locale: 'kz', title: attTitle, description: null },
                        });
                    }
                }
                attachmentFileIds = created;
            }

            // Create or update WebinarChapterItem.
            //
            // Phase 20: `accessibility` is now an item-level column. We write it
            // for ALL types (file/quiz/assignment). For `type='file'` the value is
            // ALSO mirrored onto Files.accessibility above (legacy gate path).
            if (chapterItemId) {
                const data: Record<string, unknown> = {
                    type: dto.type,
                    item_id: fileId,
                    chapter_id: dto.chapter_id,
                };
                if (typeof dto.order === 'number') data.order = dto.order;
                if (typeof dto.is_required === 'boolean') data.is_required = dto.is_required;
                if (dto.accessibility !== undefined) data.accessibility = dto.accessibility;
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
                        is_required: dto.is_required !== false,
                        accessibility: dto.accessibility ?? 'free',
                        created_at: now,
                    },
                    select: { id: true },
                });
                chapterItemId = Number(created.id);
            }

            // Phase 29 — (re)write the PDF bridge rows for this item, ordered.
            // Replaces the block's previous PDFs (old Files rows are retained,
            // consistent with deleteItem's orphan-retain policy).
            if (pdfFileIds) {
                await tx.webinarChapterItemPdfFile.deleteMany({
                    where: { webinar_chapter_item_id: chapterItemId },
                });
                for (let i = 0; i < pdfFileIds.length; i++) {
                    await tx.webinarChapterItemPdfFile.create({
                        data: {
                            webinar_chapter_item_id: chapterItemId,
                            file_id: pdfFileIds[i],
                            sort_order: i,
                            created_at: now,
                        },
                    });
                }
            }

            // Phase 30 — (re)write the attachment bridge rows, ordered. Replaces the
            // item's previous attachments (old Files rows retained as orphans).
            if (attachmentFileIds !== undefined) {
                await tx.webinarChapterItemAttachment.deleteMany({
                    where: { webinar_chapter_item_id: chapterItemId },
                });
                for (let i = 0; i < attachmentFileIds.length; i++) {
                    await tx.webinarChapterItemAttachment.create({
                        data: {
                            webinar_chapter_item_id: chapterItemId,
                            file_id: attachmentFileIds[i],
                            sort_order: i,
                            created_at: now,
                        },
                    });
                }
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
                    select: { id: true, type: true, order: true, item_id: true, is_required: true, accessibility: true },
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
                .filter((t: any) => t.locale === 'kz')
                .map((t: any) => ({
                    locale: 'kz' as const,
                    title: t.title,
                    description: null,
                })),
            items: (row.items ?? []).map((it: any) => ({
                id: Number(it.id),
                type: it.type,
                order: it.order == null ? null : Number(it.order),
                item_id: Number(it.item_id),
                is_required: it.is_required !== false,
                accessibility: it.accessibility ?? 'free',
                file: null,
                quiz: null,
                assignment: null,
                pdfs: [],
                attachments: [],
                translations: [],
            })),
        };
    }

    private async readItemDto(tx: PrismaService, itemId: number): Promise<ChapterItemDto> {
        const row: any = await tx.webinarChapterItem.findFirst({
            where: { id: itemId },
            select: {
                id: true,
                type: true,
                order: true,
                item_id: true,
                is_required: true,
                accessibility: true,
            },
        });
        if (!row) throw new NotFoundException('items.not_in_course');

        // Hydrate file / quiz / assignment ref + translations (only when type='file').
        let file: ChapterItemDto['file'] = null;
        let quiz: ChapterItemDto['quiz'] = null;
        let assignment: ChapterItemDto['assignment'] = null;
        let pdfs: ChapterItemDto['pdfs'] = [];
        let attachments: ChapterItemDto['attachments'] = [];
        let translations: ChapterItemDto['translations'] = [];

        if (row.type === 'file') {
            // Phase 29 — if this item is a multi-file PDF block, hydrate the
            // ordered list from the bridge.
            const pdfRows: any[] = await tx.webinarChapterItemPdfFile.findMany({
                where: { webinar_chapter_item_id: Number(row.id) },
                orderBy: { sort_order: 'asc' },
                select: {
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
            pdfs = pdfRows
                .filter((r) => r.file)
                .map((r) => ({
                    id: Number(r.file.id),
                    file: r.file.file,
                    volume: r.file.volume,
                    title: r.file.translations?.[0]?.title ?? '',
                }));
        }

        if (row.type === 'file') {
            const f: any = await tx.files.findFirst({
                where: { id: Number(row.item_id) },
                select: {
                    id: true,
                    file_type: true,
                    storage: true,
                    file: true,
                    volume: true,
                    accessibility: true,
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
                    accessibility: f.accessibility,
                };
                translations = (f.translations ?? [])
                    .filter((t: any) => t.locale === 'kz')
                    .map((t: any) => ({
                        locale: 'kz' as const,
                        title: t.title,
                        description: t.description ?? null,
                    }));
            }
        } else if (row.type === 'quiz') {
            const q: any = await tx.quizzes.findFirst({
                where: { id: Number(row.item_id) },
                select: {
                    id: true,
                    translations: {
                        where: { locale: 'kz' },
                        select: { title: true },
                        take: 1,
                    },
                },
            });
            if (q) {
                // Quizzes has no slug column — surface KZ translation title as label proxy.
                quiz = { id: Number(q.id), slug: q.translations?.[0]?.title ?? '' };
            }
        } else if (row.type === 'assignment') {
            const a: any = await tx.webinarAssignment.findFirst({
                where: { id: Number(row.item_id) },
                select: {
                    id: true,
                    translations: {
                        where: { locale: 'kz' },
                        select: { title: true },
                        take: 1,
                    },
                },
            });
            if (a) {
                assignment = { id: Number(a.id), title: a.translations?.[0]?.title ?? '' };
            }
        }

        // Phase 30 — hydrate the lecture-notes attachments (up to 3, any type), ordered.
        if (row.type === 'file') {
            const attRows: any[] = await tx.webinarChapterItemAttachment.findMany({
                where: { webinar_chapter_item_id: Number(row.id) },
                orderBy: { sort_order: 'asc' },
                select: {
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
            attachments = attRows
                .filter((r) => r.file)
                .map((r) => ({
                    id: Number(r.file.id),
                    file: r.file.file,
                    file_type: r.file.file_type,
                    volume: r.file.volume,
                    title: r.file.translations?.[0]?.title ?? '',
                }));
        }

        return {
            id: Number(row.id),
            type: row.type,
            order: row.order == null ? null : Number(row.order),
            item_id: Number(row.item_id),
            is_required: row.is_required !== false,
            accessibility: row.accessibility ?? 'free',
            file,
            quiz,
            assignment,
            pdfs,
            attachments,
            translations,
        };
    }
}

function nowSeconds(): number {
    return Math.floor(Date.now() / 1000);
}
