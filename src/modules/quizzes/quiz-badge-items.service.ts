import {
    BadRequestException,
    ConflictException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { apiResponse } from '../../common/utils/api-response';
import { UpsertBadgeItemDto } from './dto/upsert-badge-item.dto';
import { ReorderBadgeItemsDto } from './dto/reorder-badge-items.dto';
import { QuizzesCacheService } from './utils/quizzes-cache.service';
import { QUIZZES_INVALIDATE_PATTERN } from './utils/quizzes-cache';

/**
 * QZ-05 — QuizBadgeItem (member quizzes inside a Пробное ЕНТ) management
 * (Phase 6 Plan 06).
 *
 * Endpoints (controller):
 *   POST   /admin-api/v1/admin/quiz-badges/:badgeId/items                 — admin only
 *   PATCH  /admin-api/v1/admin/quiz-badges/:badgeId/items/reorder         — admin only
 *   DELETE /admin-api/v1/admin/quiz-badges/:badgeId/items/:itemId         — admin only
 *
 * Schema-truth (verified against prisma/schema.prisma:671-682):
 *   - QuizBadgeItem: id Int @id, quiz_badge_id Int (FK Cascade), quiz_id Int @db.UnsignedInt
 *     (FK Cascade), order Int? @db.UnsignedInt, created_at DateTime @default(now()),
 *     updated_at DateTime?
 *   - There is NO @@unique([quiz_badge_id, quiz_id]) — duplicate protection lives in
 *     application code (see addItem; T-06-72).
 *
 * Threat mitigations:
 *   - T-06-70 (Tampering / foreign reorder ids): reorderItems pre-flight asserts every
 *     items[].id has quiz_badge_id === path :badgeId, else 400 'reorder.foreign_id'.
 *   - T-06-71 (Tampering / non-existent quiz_id): addItem validates Quizzes.findUnique
 *     before insert, else 404 'quiz_badges.quiz_not_found'.
 *   - T-06-72 (Tampering / duplicate quiz): addItem rejects on findFirst({badge_id,
 *     quiz_id}) hit with 409 'quiz_badges.duplicate_quiz_in_badge'. Idempotent semantics.
 *
 * Cache invalidation: every mutation calls cache.invalidate(QUIZZES_INVALIDATE_PATTERN)
 * AFTER tx commits — matches the namespace used by badges service + list service so
 * the badge filter dropdown in Plan 02 picks up new memberships immediately.
 */
@Injectable()
export class QuizBadgeItemsService {
    private readonly logger = new Logger(QuizBadgeItemsService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly cache: QuizzesCacheService,
    ) {}

    /**
     * POST /admin-api/v1/admin/quiz-badges/:badgeId/items
     *
     * Body: UpsertBadgeItemDto with id absent (create only — update via reorder endpoint).
     * - Validates badge exists.
     * - Validates quiz_id exists (T-06-71).
     * - Rejects duplicate (T-06-72) with 409 'quiz_badges.duplicate_quiz_in_badge'.
     * - Auto-assigns order = MAX(order WHERE quiz_badge_id=:id) + 1 when omitted.
     * - Commits in single $tx; invalidates cache.
     */
    public async addItem(badgeId: number, dto: UpsertBadgeItemDto) {
        // Path :badgeId is the source of truth — if dto.quiz_badge_id was supplied and
        // disagrees, prefer the path (defensive; prevents trivial tampering).
        const targetBadgeId = badgeId;

        const badge: any = await this.prisma.quizBadge.findUnique({
            where: { id: targetBadgeId },
            select: { id: true },
        });
        if (!badge) throw new NotFoundException('quiz_badges.not_found');

        const quiz: any = await this.prisma.quizzes.findUnique({
            where: { id: dto.quiz_id },
            select: { id: true },
        });
        if (!quiz) throw new NotFoundException('quiz_badges.quiz_not_found');

        const dup: any = await this.prisma.quizBadgeItem.findFirst({
            where: { quiz_badge_id: targetBadgeId, quiz_id: dto.quiz_id },
            select: { id: true },
        });
        if (dup) {
            throw new ConflictException(
                apiResponse(0, 'duplicate_quiz_in_badge', 'quiz_badges.duplicate_quiz_in_badge'),
            );
        }

        // Auto-assign order = MAX(order)+1 when omitted.
        let nextOrder: number;
        if (typeof dto.order === 'number') {
            nextOrder = dto.order;
        } else {
            const agg: any = await this.prisma.quizBadgeItem.aggregate({
                where: { quiz_badge_id: targetBadgeId },
                _max: { order: true },
            });
            nextOrder = (agg?._max?.order ?? 0) + 1;
        }

        const created: any = await this.prisma.$transaction(async (tx) => {
            return tx.quizBadgeItem.create({
                data: {
                    quiz_badge_id: targetBadgeId,
                    quiz_id: dto.quiz_id,
                    order: nextOrder,
                },
                select: { id: true, quiz_badge_id: true, quiz_id: true, order: true, created_at: true, updated_at: true },
            });
        });

        await this.cache.invalidate(QUIZZES_INVALIDATE_PATTERN);
        return apiResponse(1, 'created', 'quiz_badges.item.created', {
            id: Number(created.id),
            quiz_badge_id: Number(created.quiz_badge_id),
            quiz_id: Number(created.quiz_id),
            order: created.order == null ? null : Number(created.order),
            created_at: created.created_at instanceof Date ? created.created_at.toISOString() : created.created_at,
            updated_at:
                created.updated_at instanceof Date
                    ? created.updated_at.toISOString()
                    : (created.updated_at ?? null),
        });
    }

    /**
     * PATCH /admin-api/v1/admin/quiz-badges/:badgeId/items/reorder
     *
     * Body: { items: [{id, order}] }.
     * Pre-flight (T-06-70): every items[].id MUST have quiz_badge_id===:badgeId
     * (count check via findMany). Reject foreign ids with 400 'reorder.foreign_id'.
     * Single $tx batch updates each row's order.
     */
    public async reorderItems(badgeId: number, dto: ReorderBadgeItemsDto) {
        const badge: any = await this.prisma.quizBadge.findUnique({
            where: { id: badgeId },
            select: { id: true },
        });
        if (!badge) throw new NotFoundException('quiz_badges.not_found');

        const ids = dto.items.map((i) => i.id);
        if (new Set(ids).size !== ids.length) {
            throw new BadRequestException('quiz_badges.reorder.duplicate_id');
        }

        // Pre-flight: all ids must belong to THIS badge (T-06-70).
        const found: any[] = await this.prisma.quizBadgeItem.findMany({
            where: { id: { in: ids }, quiz_badge_id: badgeId },
            select: { id: true },
        });
        if (found.length !== ids.length) {
            throw new BadRequestException('quiz_badges.reorder.foreign_id');
        }

        await this.prisma.$transaction(
            dto.items.map((i) =>
                this.prisma.quizBadgeItem.update({
                    where: { id: i.id },
                    data: { order: i.order, updated_at: new Date() },
                }),
            ),
        );

        await this.cache.invalidate(QUIZZES_INVALIDATE_PATTERN);
        return apiResponse(1, 'reordered', 'quiz_badges.item.reordered', {
            count: dto.items.length,
        });
    }

    /**
     * DELETE /admin-api/v1/admin/quiz-badges/:badgeId/items/:itemId
     *
     * Hard delete (item is just a join row — safe). Pre-flight asserts item belongs
     * to :badgeId (T-06-70 belt-and-braces).
     */
    public async removeItem(badgeId: number, itemId: number) {
        const item: any = await this.prisma.quizBadgeItem.findUnique({
            where: { id: itemId },
            select: { id: true, quiz_badge_id: true },
        });
        if (!item) throw new NotFoundException('quiz_badges.item.not_found');
        if (Number(item.quiz_badge_id) !== badgeId) {
            throw new BadRequestException('quiz_badges.item.foreign_badge');
        }

        await this.prisma.quizBadgeItem.delete({ where: { id: itemId } });
        await this.cache.invalidate(QUIZZES_INVALIDATE_PATTERN);
        return apiResponse(1, 'deleted', 'quiz_badges.item.deleted', { id: itemId, deleted: true });
    }
}
