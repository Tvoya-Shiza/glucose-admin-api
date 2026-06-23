import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { apiResponse } from '../../common/utils/api-response';
import type { ScopeActor } from '../../common/scoping/scope.types';
import type { CourseDetailDto } from './dto/course-detail.dto';
import { CoursesDetailService } from './courses-detail.service';
import { CoursesCacheService } from './utils/courses-cache.service';
import { COURSES_INVALIDATE_PATTERN } from './utils/course-cache';

/**
 * CRS-DUP — POST /admin-api/v1/admin/courses/:id/duplicate.
 *
 * Single $transaction deep copy of one course (Webinar, type='course') with its full
 * owned content tree. Modelled on QuizzesDuplicateService (load-graph-before-tx → one
 * $transaction → cache invalidate → return detail + meta).
 *
 * DEEP-COPIED (owned content):
 *   Webinar
 *   ├── WebinarTranslations           (kz title gets a " (көшірме)" marker)
 *   ├── WebinarPrices                 (only when is_paid)
 *   └── WebinarChapter (+ WebinarChapterTranslation)
 *       └── WebinarChapterItem (polymorphic by type/item_id):
 *           ├── file  → new Files (+ FileTranslations); PDF blocks copied via the
 *           │           WebinarChapterItemPdfFile bridge; lecture-notes via the
 *           │           WebinarChapterItemAttachment bridge (each a fresh Files row).
 *           ├── quiz  → item_id kept verbatim (Quizzes is a SHARED/global entity —
 *           │           never deep-copied; WebinarQuiz bridge is NOT written, matching
 *           │           courses-content.service.ts upsertItem, so the clone keeps
 *           │           behavioural parity with the source).
 *           └── assignment → new WebinarAssignment (+ translations + attachments).
 *
 * NOT COPIED (deliberate — fresh draft starts clean, mirrors the quiz duplicate which
 * starts "un-assigned"):
 *   LessonAccessRestriction (Phase 33 per-group whitelist), CourseContentOverride
 *   (Phase 19 per-user/per-group unlocks), LessonSchedule / WebinarChapterSchedule
 *   (operational scheduling), WebinarQuiz bridge, and all runtime/transactional data
 *   (Sale/Order, WebinarReviews, Cart, progress/results).
 *
 * Shared-storage note: a copied Files row reuses the source `file` URL/path — the
 * binary itself is NOT duplicated (the upload flow mints a fresh key per upload, so two
 * Webinars referencing the same object is benign; deletes are row-scoped, never touch
 * the blob). Same reasoning for WebinarAssignmentAttachment.attach.
 *
 * Status: the duplicate is forced to 'is_draft' so a half-edited clone never reaches
 * students; slug gets a collision-proof '-copy' suffix (Webinar.slug has no @unique —
 * we de-dupe defensively). position is reset to null (catalog-ordering slot).
 *
 * Scope: admin / teacher (own course) pass; curator → 403 (defensive — controller
 * @Roles still lists curator for surface uniformity, the service gate enforces it).
 *
 * Performance: interactive $transaction with an explicit timeout — a deep course is
 * many sequential writes and would blow Prisma's default 5s interactive-tx budget
 * (P2028). Load-graph-before-tx keeps the 404/403 path out of any transaction.
 */
@Injectable()
export class CoursesDuplicateService {
    private readonly logger = new Logger(CoursesDuplicateService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly cache: CoursesCacheService,
        private readonly detailService: CoursesDetailService,
    ) {}

    public async duplicate(actor: ScopeActor, sourceId: number): Promise<{ success: boolean }> {
        // ── Scope gate (3-step: existence → teacher gate; curator default-deny) ──────
        if (actor.role_name === 'curator') {
            throw new ForbiddenException('courses.forbidden_scope');
        }
        const existing: any = await this.prisma.webinar.findFirst({
            where: { id: sourceId, deleted_at: null },
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

        // ── Load the full source graph BEFORE the tx ────────────────────────────────
        const source: any = await this.prisma.webinar.findFirst({
            where: { id: sourceId, deleted_at: null },
            select: {
                id: true,
                teacher_id: true,
                category_id: true,
                type: true,
                slug: true,
                start_date: true,
                duration: true,
                thumbnail: true,
                image_cover: true,
                capacity: true,
                certificate: true,
                is_paid: true,
                strict_progress: true,
                translations: { select: { locale: true, title: true, description: true } },
                prices: { select: { price: true, access_days: true }, orderBy: { id: 'asc' } },
                chapters: {
                    orderBy: [{ order: 'asc' }, { id: 'asc' }],
                    select: {
                        id: true,
                        order: true,
                        check_all_contents_pass: true,
                        status: true,
                        translations: { select: { locale: true, title: true } },
                        items: {
                            orderBy: [{ order: 'asc' }, { id: 'asc' }],
                            select: {
                                id: true,
                                item_id: true,
                                type: true,
                                order: true,
                                is_required: true,
                                accessibility: true,
                                pdf_files: {
                                    orderBy: { sort_order: 'asc' },
                                    select: { file_id: true, sort_order: true, file: { select: FILE_SELECT } },
                                },
                                attachments: {
                                    orderBy: { sort_order: 'asc' },
                                    select: { sort_order: true, file: { select: FILE_SELECT } },
                                },
                            },
                        },
                    },
                },
            },
        });
        if (!source) {
            throw new NotFoundException('courses.not_found');
        }

        // Batch-resolve the polymorphic item_id targets that are NOT carried inline by
        // the nested load: single-file items (item_id → Files) and assignment items
        // (item_id → WebinarAssignment). PDF-block file items are copied via their
        // bridge rows, so their item_id file is excluded here.
        const singleFileIds = new Set<number>();
        const assignmentIds = new Set<number>();
        for (const c of source.chapters as any[]) {
            for (const it of c.items as any[]) {
                if (it.type === 'file' && (it.pdf_files ?? []).length === 0) {
                    singleFileIds.add(Number(it.item_id));
                } else if (it.type === 'assignment') {
                    assignmentIds.add(Number(it.item_id));
                }
            }
        }

        const [singleFiles, assignments] = await Promise.all([
            singleFileIds.size === 0
                ? Promise.resolve([] as any[])
                : this.prisma.files.findMany({
                      where: { id: { in: Array.from(singleFileIds) } },
                      select: FILE_SELECT,
                  }),
            assignmentIds.size === 0
                ? Promise.resolve([] as any[])
                : this.prisma.webinarAssignment.findMany({
                      where: { id: { in: Array.from(assignmentIds) } },
                      select: {
                          id: true,
                          grade: true,
                          pass_grade: true,
                          deadline: true,
                          attempts: true,
                          check_previous_parts: true,
                          access_after_day: true,
                          status: true,
                          translations: { select: { locale: true, title: true, description: true } },
                          attachments: { select: { title: true, attach: true } },
                      },
                  }),
        ]);
        const fileById = new Map<number, any>((singleFiles as any[]).map((f) => [Number(f.id), f]));
        const assignmentById = new Map<number, any>((assignments as any[]).map((a) => [Number(a.id), a]));

        const newSlug = await this.generateUniqueSlug(source.slug);
        const now = nowSeconds();

        let chapters_copied = 0;
        let items_copied = 0;
        let files_copied = 0;
        let assignments_copied = 0;
        let orphan_refs = 0;

        // copyFile — clone one source Files row under the new course/chapter, returning
        // the new id. Translations (incl. the per-locale Tiptap description that holds
        // text-lesson bodies) are copied verbatim.
        const copyFile = async (tx: any, src: any, newChapterId: number, newWebinarId: number): Promise<number> => {
            const created: any = await tx.files.create({
                data: {
                    creator_id: actor.id,
                    webinar_id: newWebinarId,
                    chapter_id: newChapterId,
                    accessibility: src.accessibility,
                    downloadable: !!src.downloadable,
                    storage: src.storage,
                    file: src.file,
                    volume: src.volume,
                    file_type: src.file_type,
                    check_previous_parts: !!src.check_previous_parts,
                    access_after_day: src.access_after_day ?? null,
                    order: src.order ?? null,
                    status: src.status,
                    created_at: now,
                },
                select: { id: true },
            });
            const newId = Number(created.id);
            const trs = (src.translations ?? []) as any[];
            if (trs.length > 0) {
                await tx.fileTranslations.createMany({
                    data: trs.map((t) => ({
                        file_id: newId,
                        locale: t.locale,
                        title: t.title,
                        description: t.description ?? null,
                    })),
                });
            }
            files_copied++;
            return newId;
        };

        const newCourseId: number = await this.prisma.$transaction(
            async (tx) => {
                // 1. Webinar row.
                const newWebinar: any = await tx.webinar.create({
                    data: {
                        teacher_id: source.teacher_id,
                        creator_id: actor.id,
                        category_id: source.category_id ?? null,
                        type: source.type,
                        slug: newSlug,
                        start_date: source.start_date ?? null,
                        duration: source.duration ?? null,
                        thumbnail: source.thumbnail ?? '',
                        image_cover: source.image_cover ?? '',
                        capacity: source.capacity ?? null,
                        certificate: !!source.certificate,
                        is_paid: !!source.is_paid,
                        strict_progress: !!source.strict_progress,
                        status: 'is_draft',
                        position: null,
                        created_at: now,
                    },
                    select: { id: true },
                });
                const newWebinarId = Number(newWebinar.id);

                // 2. Translations (+ copy marker on kz title) + prices.
                if ((source.translations ?? []).length > 0) {
                    await tx.webinarTranslations.createMany({
                        data: (source.translations as any[]).map((t) => ({
                            webinar_id: newWebinarId,
                            locale: t.locale,
                            title: t.locale === 'kz' ? appendCopyMarker(t.title) : t.title,
                            description: t.description ?? null,
                        })),
                    });
                }
                if (source.is_paid && (source.prices ?? []).length > 0) {
                    await tx.webinarPrices.createMany({
                        data: (source.prices as any[]).map((p) => ({
                            webinar_id: newWebinarId,
                            price: p.price,
                            access_days: p.access_days,
                        })),
                    });
                }

                // 3. Chapters → items.
                for (const ch of source.chapters as any[]) {
                    const newChapter: any = await tx.webinarChapter.create({
                        data: {
                            user_id: actor.id,
                            webinar_id: newWebinarId,
                            order: ch.order ?? null,
                            check_all_contents_pass: !!ch.check_all_contents_pass,
                            status: ch.status,
                            created_at: now,
                        },
                        select: { id: true },
                    });
                    const newChapterId = Number(newChapter.id);
                    chapters_copied++;

                    const chTrs = (ch.translations ?? []) as any[];
                    if (chTrs.length > 0) {
                        await tx.webinarChapterTranslation.createMany({
                            data: chTrs.map((t) => ({
                                webinar_chapter_id: newChapterId,
                                locale: t.locale,
                                title: t.title,
                            })),
                        });
                    }

                    for (const it of ch.items as any[]) {
                        let newItemRef = Number(it.item_id); // default: orphan passthrough.
                        let pdfBridge: Array<{ file_id: number; sort_order: number }> = [];

                        if (it.type === 'file') {
                            const pdfRows = (it.pdf_files ?? []) as any[];
                            if (pdfRows.length > 0) {
                                // PDF block — copy every bridge file; item_id = the new file
                                // that maps from the source item_id (fallback: first PDF).
                                const oldToNew = new Map<number, number>();
                                for (const pr of pdfRows) {
                                    if (!pr.file) continue;
                                    const newFileId = await copyFile(tx, pr.file, newChapterId, newWebinarId);
                                    oldToNew.set(Number(pr.file_id), newFileId);
                                    pdfBridge.push({ file_id: newFileId, sort_order: Number(pr.sort_order ?? 0) });
                                }
                                const firstNew = pdfBridge.length > 0 ? pdfBridge[0].file_id : null;
                                newItemRef = oldToNew.get(Number(it.item_id)) ?? firstNew ?? Number(it.item_id);
                                if (oldToNew.size === 0) orphan_refs++;
                            } else {
                                const src = fileById.get(Number(it.item_id));
                                if (src) {
                                    newItemRef = await copyFile(tx, src, newChapterId, newWebinarId);
                                } else {
                                    orphan_refs++;
                                }
                            }
                        } else if (it.type === 'assignment') {
                            const src = assignmentById.get(Number(it.item_id));
                            if (src) {
                                const newAssignment: any = await tx.webinarAssignment.create({
                                    data: {
                                        creator_id: actor.id,
                                        webinar_id: newWebinarId,
                                        chapter_id: newChapterId,
                                        grade: src.grade ?? null,
                                        pass_grade: src.pass_grade ?? null,
                                        deadline: src.deadline ?? null,
                                        attempts: src.attempts ?? null,
                                        check_previous_parts: !!src.check_previous_parts,
                                        access_after_day: src.access_after_day ?? null,
                                        status: src.status,
                                        created_at: BigInt(now),
                                    },
                                    select: { id: true },
                                });
                                const newAssignmentId = Number(newAssignment.id);
                                newItemRef = newAssignmentId;
                                const aTrs = (src.translations ?? []) as any[];
                                if (aTrs.length > 0) {
                                    await tx.webinarAssignmentTranslation.createMany({
                                        data: aTrs.map((t) => ({
                                            webinar_assignment_id: newAssignmentId,
                                            locale: t.locale,
                                            title: t.title,
                                            description: t.description,
                                        })),
                                    });
                                }
                                const aAtt = (src.attachments ?? []) as any[];
                                if (aAtt.length > 0) {
                                    await tx.webinarAssignmentAttachment.createMany({
                                        data: aAtt.map((at) => ({
                                            creator_id: actor.id,
                                            assignment_id: newAssignmentId,
                                            title: at.title,
                                            attach: at.attach,
                                        })),
                                    });
                                }
                                assignments_copied++;
                            } else {
                                orphan_refs++;
                            }
                        }
                        // quiz: newItemRef stays = source item_id (shared Quizzes row).

                        const newItem: any = await tx.webinarChapterItem.create({
                            data: {
                                user_id: actor.id,
                                chapter_id: newChapterId,
                                item_id: newItemRef,
                                type: it.type,
                                order: it.order ?? null,
                                is_required: it.is_required !== false,
                                accessibility: it.accessibility ?? 'free',
                                created_at: now,
                            },
                            select: { id: true },
                        });
                        const newItemId = Number(newItem.id);
                        items_copied++;

                        // PDF bridge rows (ordered).
                        if (pdfBridge.length > 0) {
                            await tx.webinarChapterItemPdfFile.createMany({
                                data: pdfBridge.map((b) => ({
                                    webinar_chapter_item_id: newItemId,
                                    file_id: b.file_id,
                                    sort_order: b.sort_order,
                                    created_at: now,
                                })),
                            });
                        }

                        // Lecture-notes attachments (file items only) — fresh Files row each.
                        const attRows = (it.attachments ?? []) as any[];
                        if (attRows.length > 0) {
                            const bridge: Array<{ file_id: number; sort_order: number }> = [];
                            for (const ar of attRows) {
                                if (!ar.file) continue;
                                const newFileId = await copyFile(tx, ar.file, newChapterId, newWebinarId);
                                bridge.push({ file_id: newFileId, sort_order: Number(ar.sort_order ?? 0) });
                            }
                            if (bridge.length > 0) {
                                await tx.webinarChapterItemAttachment.createMany({
                                    data: bridge.map((b) => ({
                                        webinar_chapter_item_id: newItemId,
                                        file_id: b.file_id,
                                        sort_order: b.sort_order,
                                        created_at: now,
                                    })),
                                });
                            }
                        }
                    }
                }

                return newWebinarId;
            },
            { timeout: 120_000, maxWait: 10_000 },
        );

        await this.cache.invalidate(COURSES_INVALIDATE_PATTERN);

        if (orphan_refs > 0) {
            this.logger.warn(
                `courses.duplicate: source ${sourceId} -> new ${newCourseId} had ${orphan_refs} orphan item_id ref(s); item(s) preserved with the dangling reference`,
            );
        }

        const detail: CourseDetailDto = await this.detailService.getDetail(actor, newCourseId);
        const data = {
            ...detail,
            source_course_id: sourceId,
            new_course_id: newCourseId,
            chapters_copied,
            items_copied,
            files_copied,
            assignments_copied,
            orphan_refs,
        };
        return apiResponse(1, 'duplicated', 'courses.duplicated', data);
    }

    /**
     * Webinar.slug has no @unique constraint, so a collision won't throw — we de-dupe
     * defensively so slug-based routing on the student side stays sane. Picks the first
     * free of `<base>-copy`, `<base>-copy-2`, … keeping the result within VarChar(255).
     */
    private async generateUniqueSlug(sourceSlug: string): Promise<string> {
        const base = (sourceSlug ?? '').slice(0, 240) || 'course';
        const existing: any[] = await this.prisma.webinar.findMany({
            where: { slug: { startsWith: base } },
            select: { slug: true },
        });
        const taken = new Set(existing.map((r) => r.slug));
        let candidate = `${base}-copy`;
        let n = 2;
        while (taken.has(candidate)) {
            candidate = `${base}-copy-${n}`;
            n++;
        }
        return candidate;
    }
}

/** Shared Files select shape (single-file items, PDF-block bridge, attachment bridge). */
const FILE_SELECT = {
    id: true,
    accessibility: true,
    downloadable: true,
    storage: true,
    file: true,
    volume: true,
    file_type: true,
    check_previous_parts: true,
    access_after_day: true,
    order: true,
    status: true,
    translations: { select: { locale: true, title: true, description: true } },
} as const;

/** Append the KZ "(көшірме)" copy marker, keeping the title within VarChar(255). */
function appendCopyMarker(title: string): string {
    return `${title} (көшірме)`.slice(0, 255);
}

function nowSeconds(): number {
    return Math.floor(Date.now() / 1000);
}
