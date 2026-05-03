import {
    BadRequestException,
    ConflictException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { apiResponse } from '../../common/utils/api-response';
import { UpsertCategoryDto } from './dto/upsert-category.dto';
import { QuizzesCacheService } from './utils/quizzes-cache.service';
import { QUIZZES_INVALIDATE_PATTERN } from './utils/quizzes-cache';
import { nowSec } from './quizzes-mutations.service';

/**
 * QZ-04 — QuizCategory tree CRUD (Phase 6 Plan 03).
 *
 * Endpoints (controller):
 *   GET    /admin-api/v1/admin/quiz-categories          — admin/curator/teacher (selector use)
 *   POST   /admin-api/v1/admin/quiz-categories          — admin only
 *   PATCH  /admin-api/v1/admin/quiz-categories/:id      — admin only
 *   DELETE /admin-api/v1/admin/quiz-categories/:id      — admin only
 *
 * Schema-truth (verified against prisma/schema.prisma:504-533):
 *   - QuizCategory: id Int @id, parent_id Int? (self-FK, parent.onDelete: Cascade),
 *     subject_id Int?, created_at Int?, updated_at Int? — NO `name`, NO `order`.
 *   - QuizCategoryTranslation: quiz_category_id Int, locale String, title VarChar(255),
 *     parent.onDelete: Cascade. NO @@unique([quiz_category_id, locale]) → upsert via
 *     find-then-update.
 *   - Quizzes.category_id is Int? (line 460); FK has `onDelete: Cascade` (line 476).
 *     ★ DANGER: a naive `prisma.quizCategory.delete()` would CASCADE-DELETE every
 *     quiz in that category. We MUST re-point quizzes.category_id → null in the same
 *     $transaction BEFORE deleting the category row, so the cascade has no rows to
 *     hit on the quizzes side.
 *
 * Force-delete strategy (D-16, T-06-31):
 *   - Without ?force=true: if quiz_count>0 OR child_count>0, throw
 *     ConflictException({status:'quiz_categories.cascade_blocked', quiz_count, child_count}).
 *   - With ?force=true: in a single $transaction:
 *       1. UPDATE quizzes SET category_id=NULL WHERE category_id=:id   (quizzes survive)
 *       2. UPDATE quiz_categories SET parent_id=:targetParent WHERE parent_id=:id
 *          (children re-pointed to GRANDPARENT, preserving hierarchy)
 *       3. DELETE quiz_categories WHERE id=:id (translations cascade naturally)
 *     Response payload includes {quizzes_repointed, children_repointed}; AuditInterceptor
 *     records this in NDJSON meta.
 *
 * Cycle detection (T-06-30) on update:
 *   When parent_id is being changed to a non-null value, walk upward from the new
 *   parent_id following parent_id pointers. If at any hop we land on the row being
 *   updated (`id`), that means the new parent is a descendant — reject 400. A 100-hop
 *   cap surfaces 'depth_overflow' on corrupted data rather than spinning forever.
 *
 * Cache (D-26):
 *   - List read cached at `geonline-admin:quiz-categories:list` (60s TTL).
 *   - Every mutation invalidates `geonline-admin:quizzes:*` (matches the namespace
 *     used by Plan 02; the categories list key is included in that pattern).
 */
@Injectable()
export class QuizCategoriesService {
    private readonly logger = new Logger(QuizCategoriesService.name);

    private static readonly LIST_CACHE_KEY = 'geonline-admin:quizzes:categories:list';
    private static readonly LIST_CACHE_TTL_SECONDS = 60;
    private static readonly CYCLE_HOP_CAP = 100;

    constructor(
        private readonly prisma: PrismaService,
        private readonly cache: QuizzesCacheService,
    ) {}

    /**
     * GET /admin-api/v1/admin/quiz-categories — flat array (client builds tree).
     */
    public async listAll() {
        return this.cache.getOrSet(
            QuizCategoriesService.LIST_CACHE_KEY,
            async () => {
                const rows: any[] = await this.prisma.quizCategory.findMany({
                    include: {
                        translations: { select: { locale: true, title: true } },
                        _count: { select: { quizzes: true, children: true } },
                    },
                    orderBy: { id: 'asc' },
                });
                const out = rows.map((r) => ({
                    id: Number(r.id),
                    parent_id: r.parent_id == null ? null : Number(r.parent_id),
                    subject_id: r.subject_id == null ? null : Number(r.subject_id),
                    translations: ((r.translations ?? []) as any[])
                        .filter((t) => t.locale === 'ru' || t.locale === 'kz')
                        .map((t) => ({ locale: t.locale, title: t.title })),
                    quiz_count: Number(r._count?.quizzes ?? 0),
                    child_count: Number(r._count?.children ?? 0),
                    created_at: r.created_at == null ? null : Number(r.created_at),
                    updated_at: r.updated_at == null ? null : Number(r.updated_at),
                }));
                return { rows: out };
            },
            QuizCategoriesService.LIST_CACHE_TTL_SECONDS,
        );
    }

    public async create(dto: UpsertCategoryDto) {
        const parentId = typeof dto.parent_id === 'number' ? dto.parent_id : null;
        if (parentId != null) {
            const parent: any = await this.prisma.quizCategory.findUnique({
                where: { id: parentId },
                select: { id: true },
            });
            if (!parent) throw new BadRequestException('quiz_categories.parent_not_found');
        }
        const subjectId = typeof dto.subject_id === 'number' ? dto.subject_id : null;
        if (subjectId != null) {
            const sub: any = await this.prisma.quizSubject.findUnique({
                where: { id: subjectId },
                select: { id: true },
            });
            if (!sub) throw new BadRequestException('quiz_categories.subject_not_found');
        }

        const now = nowSec();

        const created: any = await this.prisma.$transaction(async (tx) => {
            const row: any = await tx.quizCategory.create({
                data: {
                    parent_id: parentId,
                    subject_id: subjectId,
                    created_at: now,
                },
                select: { id: true },
            });
            if (Array.isArray(dto.translations) && dto.translations.length > 0) {
                await tx.quizCategoryTranslation.createMany({
                    data: dto.translations.map((t) => ({
                        quiz_category_id: row.id,
                        locale: t.locale,
                        title: t.title,
                    })),
                });
            }
            return row;
        });

        await this.cache.invalidate(QUIZZES_INVALIDATE_PATTERN);
        const detail = await this.readRow(Number(created.id));
        return apiResponse(1, 'created', 'quiz_categories.created', detail);
    }

    public async update(id: number, dto: UpsertCategoryDto) {
        const existing: any = await this.prisma.quizCategory.findUnique({
            where: { id },
            select: { id: true, parent_id: true },
        });
        if (!existing) throw new NotFoundException('quiz_categories.not_found');

        const newParentProvided = Object.prototype.hasOwnProperty.call(dto, 'parent_id');
        const newParentId =
            newParentProvided && typeof dto.parent_id === 'number' ? dto.parent_id : null;

        // Cycle protection — only when parent_id is changing to a non-null value.
        if (newParentProvided && newParentId != null && newParentId !== existing.parent_id) {
            if (newParentId === id) {
                throw new BadRequestException('quiz_categories.cycle_detected');
            }
            await this.assertNoCycle(id, newParentId);
        }

        // Subject existence check.
        const subjectProvided = Object.prototype.hasOwnProperty.call(dto, 'subject_id');
        if (subjectProvided && typeof dto.subject_id === 'number') {
            const sub: any = await this.prisma.quizSubject.findUnique({
                where: { id: dto.subject_id },
                select: { id: true },
            });
            if (!sub) throw new BadRequestException('quiz_categories.subject_not_found');
        }

        const now = nowSec();
        const data: Record<string, unknown> = { updated_at: now };
        if (newParentProvided) data.parent_id = newParentId;
        if (subjectProvided) {
            data.subject_id = typeof dto.subject_id === 'number' ? dto.subject_id : null;
        }

        await this.prisma.$transaction(async (tx) => {
            await tx.quizCategory.update({ where: { id }, data });

            if (Array.isArray(dto.translations) && dto.translations.length > 0) {
                for (const t of dto.translations) {
                    const row: any = await tx.quizCategoryTranslation.findFirst({
                        where: { quiz_category_id: id, locale: t.locale },
                        select: { id: true },
                        orderBy: { id: 'asc' },
                    });
                    if (row) {
                        await tx.quizCategoryTranslation.update({
                            where: { id: row.id },
                            data: { title: t.title },
                        });
                    } else {
                        await tx.quizCategoryTranslation.create({
                            data: {
                                quiz_category_id: id,
                                locale: t.locale,
                                title: t.title,
                            },
                        });
                    }
                }
            }
        });

        await this.cache.invalidate(QUIZZES_INVALIDATE_PATTERN);
        const detail = await this.readRow(id);
        return apiResponse(1, 'updated', 'quiz_categories.updated', detail);
    }

    /**
     * DELETE /admin-api/v1/admin/quiz-categories/:id
     *
     * Without ?force=true: 409 if quiz_count>0 OR child_count>0 (D-16 cascade-blocked).
     * With ?force=true: re-point quizzes → null AND children → grandparent in $tx, then delete.
     */
    public async remove(id: number, force: boolean) {
        const target: any = await this.prisma.quizCategory.findUnique({
            where: { id },
            select: { id: true, parent_id: true },
        });
        if (!target) throw new NotFoundException('quiz_categories.not_found');

        const [quiz_count, child_count] = await Promise.all([
            this.prisma.quizzes.count({ where: { category_id: id } }),
            this.prisma.quizCategory.count({ where: { parent_id: id } }),
        ]);

        if (!force && (quiz_count > 0 || child_count > 0)) {
            // 409 Conflict with structured body for the admin-client cascade dialog.
            throw new ConflictException({
                status: 'quiz_categories.cascade_blocked',
                message: 'quiz_categories.cascade_blocked',
                quiz_count,
                child_count,
            });
        }

        const result: any = await this.prisma.$transaction(async (tx) => {
            // Re-point dependent quizzes to NULL category — survives the upcoming delete.
            // Without this step, schema cascade (Quizzes.category_id onDelete: Cascade)
            // would nuke every quiz in the category.
            const repointedQuizzes = await tx.quizzes.updateMany({
                where: { category_id: id },
                data: { category_id: null },
            });

            // Re-point child categories to this row's PARENT (grandparent) so subtree
            // hierarchy is preserved one level shallower instead of being orphaned.
            const repointedChildren = await tx.quizCategory.updateMany({
                where: { parent_id: id },
                data: { parent_id: target.parent_id ?? null },
            });

            // Translation rows cascade naturally (parent.onDelete: Cascade on translation FK).
            await tx.quizCategory.delete({ where: { id } });

            return {
                id,
                deleted: true,
                quizzes_repointed: repointedQuizzes.count,
                children_repointed: repointedChildren.count,
            };
        });

        if (force && (result.quizzes_repointed > 0 || result.children_repointed > 0)) {
            this.logger.log(
                `force-delete category id=${id} repointed quizzes=${result.quizzes_repointed} children=${result.children_repointed}`,
            );
        }

        await this.cache.invalidate(QUIZZES_INVALIDATE_PATTERN);
        return apiResponse(1, 'deleted', 'quiz_categories.deleted', result);
    }

    /**
     * Walk up the parent chain from `startParentId`. If we encounter `selfId` we
     * have a cycle (the new parent is a descendant of self). 100-hop cap surfaces
     * 'depth_overflow' on corrupted data.
     */
    private async assertNoCycle(selfId: number, startParentId: number): Promise<void> {
        let cursor: number | null = startParentId;
        for (let hops = 0; hops < QuizCategoriesService.CYCLE_HOP_CAP; hops++) {
            if (cursor == null) return; // reached a root, no cycle
            if (cursor === selfId) {
                throw new BadRequestException('quiz_categories.cycle_detected');
            }
            const parent: any = await this.prisma.quizCategory.findUnique({
                where: { id: cursor },
                select: { parent_id: true },
            });
            if (!parent) {
                throw new BadRequestException('quiz_categories.parent_not_found');
            }
            cursor = parent.parent_id == null ? null : Number(parent.parent_id);
        }
        // Loop exhausted without returning — corrupted data or absurdly deep tree.
        throw new BadRequestException('quiz_categories.depth_overflow');
    }

    /**
     * Re-read a single category row in the response shape used by list().
     * Used by create() / update() to return the full row after mutation.
     */
    private async readRow(id: number) {
        const r: any = await this.prisma.quizCategory.findUnique({
            where: { id },
            include: {
                translations: { select: { locale: true, title: true } },
                _count: { select: { quizzes: true, children: true } },
            },
        });
        if (!r) throw new NotFoundException('quiz_categories.not_found');
        return {
            id: Number(r.id),
            parent_id: r.parent_id == null ? null : Number(r.parent_id),
            subject_id: r.subject_id == null ? null : Number(r.subject_id),
            translations: ((r.translations ?? []) as any[])
                .filter((t) => t.locale === 'ru' || t.locale === 'kz')
                .map((t) => ({ locale: t.locale, title: t.title })),
            quiz_count: Number(r._count?.quizzes ?? 0),
            child_count: Number(r._count?.children ?? 0),
            created_at: r.created_at == null ? null : Number(r.created_at),
            updated_at: r.updated_at == null ? null : Number(r.updated_at),
        };
    }
}
