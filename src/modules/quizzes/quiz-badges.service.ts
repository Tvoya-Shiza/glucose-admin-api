import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { apiResponse } from '../../common/utils/api-response';
import { UpsertBadgeDto } from './dto/upsert-badge.dto';
import { QuizzesCacheService } from './utils/quizzes-cache.service';
import { QUIZZES_INVALIDATE_PATTERN } from './utils/quizzes-cache';

/**
 * QZ-05 — QuizBadge ("Пробное ЕНТ") CRUD (Phase 6 Plan 06).
 *
 * Endpoints (controller):
 *   GET    /admin-api/v1/admin/quiz-badges          — admin/curator/teacher (selector use)
 *   GET    /admin-api/v1/admin/quiz-badges/:id      — admin/curator/teacher (detail incl. items)
 *   POST   /admin-api/v1/admin/quiz-badges          — admin only
 *   PATCH  /admin-api/v1/admin/quiz-badges/:id      — admin only
 *   DELETE /admin-api/v1/admin/quiz-badges/:id      — admin only (soft-delete via is_active=false)
 *
 * Schema-truth (verified against prisma/schema.prisma:639-698):
 *   - QuizBadge: id Int @id, is_active Boolean @default(true), quiz_category_id Int?,
 *     created_at DateTime @default(now()), updated_at DateTime?.
 *     ★ created_at/updated_at are DateTime — NOT Unix Int. Emitted as ISO 8601 strings.
 *   - QuizBadgeTranslation: quiz_badge_id Int, locale VarChar(191), title VarChar(255),
 *     parent.onDelete: Cascade. NO @@unique([quiz_badge_id, locale]) → upsert via
 *     find-then-update.
 *   - QuizBadgeItem: id Int, quiz_badge_id Int, quiz_id Int (UnsignedInt),
 *     order Int? (UnsignedInt — persistent, unlike question/answer order).
 *
 * Soft-delete (per courses-pattern):
 *   No deleted_at column on QuizBadge — DELETE flips is_active=false. Children
 *   (items, results, sales, translations) preserved. Re-activation via PATCH.
 *
 * Cache (D-26):
 *   - List read cached at `geonline-admin:quizzes:badges:list` (60s TTL).
 *   - Detail read cached at `geonline-admin:quizzes:badges:detail:<id>` (60s TTL).
 *   - Every mutation invalidates `geonline-admin:quizzes:*` (catches both badge keys
 *     and any list/quiz-detail keys that surface badge memberships).
 */
@Injectable()
export class QuizBadgesService {
    private readonly logger = new Logger(QuizBadgesService.name);

    private static readonly LIST_CACHE_KEY = 'geonline-admin:quizzes:badges:list';
    private static readonly DETAIL_CACHE_PREFIX = 'geonline-admin:quizzes:badges:detail:';
    private static readonly CACHE_TTL_SECONDS = 60;

    constructor(
        private readonly prisma: PrismaService,
        private readonly cache: QuizzesCacheService,
    ) {}

    /**
     * GET /admin-api/v1/admin/quiz-badges — flat array.
     * Returns { rows: [...] } per truths block.
     */
    public async listAll() {
        return this.cache.getOrSet(
            QuizBadgesService.LIST_CACHE_KEY,
            async () => {
                const rows: any[] = await this.prisma.quizBadge.findMany({
                    include: {
                        translations: { select: { locale: true, title: true } },
                        _count: { select: { items: true, results: true } },
                    },
                    orderBy: { id: 'asc' },
                });

                const out = rows.map((r) => this.shapeRow(r));
                return { rows: out };
            },
            QuizBadgesService.CACHE_TTL_SECONDS,
        );
    }

    /**
     * GET /admin-api/v1/admin/quiz-badges/:id — single badge with items list ordered
     * by order ASC NULLS LAST, then id ASC.
     */
    public async getDetail(id: number) {
        return this.cache.getOrSet(
            `${QuizBadgesService.DETAIL_CACHE_PREFIX}${id}`,
            async () => {
                const r: any = await this.prisma.quizBadge.findUnique({
                    where: { id },
                    include: {
                        translations: { select: { locale: true, title: true } },
                        _count: { select: { items: true, results: true } },
                        items: {
                            // Items: order ASC NULLS LAST, tie-break id ASC.
                            // Prisma supports nulls: 'last' on MySQL via { sort, nulls } shape.
                            orderBy: [{ order: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
                            select: {
                                id: true,
                                quiz_id: true,
                                order: true,
                                created_at: true,
                                updated_at: true,
                                quiz: {
                                    select: {
                                        id: true,
                                        version: true,
                                        status: true,
                                        translations: { select: { locale: true, title: true } },
                                        _count: { select: { questions: true } },
                                    },
                                },
                            },
                        },
                    },
                });
                if (!r) throw new NotFoundException('quiz_badges.not_found');

                const base = this.shapeRow(r);
                const items = ((r.items ?? []) as any[]).map((it) => ({
                    id: Number(it.id),
                    quiz_id: Number(it.quiz_id),
                    order: it.order == null ? null : Number(it.order),
                    created_at: it.created_at instanceof Date ? it.created_at.toISOString() : it.created_at,
                    updated_at: it.updated_at instanceof Date ? it.updated_at.toISOString() : (it.updated_at ?? null),
                    quiz: it.quiz
                        ? {
                              id: Number(it.quiz.id),
                              version: Number(it.quiz.version ?? 1),
                              status: it.quiz.status,
                              translations: ((it.quiz.translations ?? []) as any[])
                                  .filter((t) => t.locale === 'ru' || t.locale === 'kz')
                                  .map((t) => ({ locale: t.locale, title: t.title })),
                              question_count: Number(it.quiz._count?.questions ?? 0),
                          }
                        : null,
                }));

                return { ...base, items };
            },
            QuizBadgesService.CACHE_TTL_SECONDS,
        );
    }

    public async create(dto: UpsertBadgeDto) {
        if (typeof dto.quiz_category_id === 'number' && dto.quiz_category_id > 0) {
            const cat: any = await this.prisma.quizCategory.findUnique({
                where: { id: dto.quiz_category_id },
                select: { id: true },
            });
            if (!cat) throw new BadRequestException('quiz_badges.category_not_found');
        }

        const created: any = await this.prisma.$transaction(async (tx) => {
            const row: any = await tx.quizBadge.create({
                data: {
                    is_active: typeof dto.is_active === 'boolean' ? dto.is_active : true,
                    quiz_category_id:
                        typeof dto.quiz_category_id === 'number' ? dto.quiz_category_id : null,
                },
                select: { id: true },
            });
            if (Array.isArray(dto.translations) && dto.translations.length > 0) {
                await tx.quizBadgeTranslation.createMany({
                    data: dto.translations.map((t) => ({
                        quiz_badge_id: row.id,
                        locale: t.locale,
                        title: t.title,
                    })),
                });
            }
            return row;
        });

        await this.cache.invalidate(QUIZZES_INVALIDATE_PATTERN);
        const detail = await this.readRow(Number(created.id));
        return apiResponse(1, 'created', 'quiz_badges.created', detail);
    }

    public async update(id: number, dto: UpsertBadgeDto) {
        const existing: any = await this.prisma.quizBadge.findUnique({
            where: { id },
            select: { id: true },
        });
        if (!existing) throw new NotFoundException('quiz_badges.not_found');

        if (typeof dto.quiz_category_id === 'number' && dto.quiz_category_id > 0) {
            const cat: any = await this.prisma.quizCategory.findUnique({
                where: { id: dto.quiz_category_id },
                select: { id: true },
            });
            if (!cat) throw new BadRequestException('quiz_badges.category_not_found');
        }

        const data: Record<string, unknown> = {};
        if (typeof dto.is_active === 'boolean') data.is_active = dto.is_active;
        const categoryProvided = Object.prototype.hasOwnProperty.call(dto, 'quiz_category_id');
        if (categoryProvided) {
            data.quiz_category_id =
                typeof dto.quiz_category_id === 'number' ? dto.quiz_category_id : null;
        }

        await this.prisma.$transaction(async (tx) => {
            // Always touch updated_at; Prisma's @db.Timestamp with no @updatedAt auto column
            // requires us to set it explicitly. The schema HAS no @updatedAt magic — we set
            // updated_at manually.
            await tx.quizBadge.update({
                where: { id },
                data: { ...data, updated_at: new Date() },
            });

            if (Array.isArray(dto.translations) && dto.translations.length > 0) {
                for (const t of dto.translations) {
                    const row: any = await tx.quizBadgeTranslation.findFirst({
                        where: { quiz_badge_id: id, locale: t.locale },
                        select: { id: true },
                        orderBy: { id: 'asc' },
                    });
                    if (row) {
                        await tx.quizBadgeTranslation.update({
                            where: { id: row.id },
                            data: { title: t.title, updated_at: new Date() },
                        });
                    } else {
                        await tx.quizBadgeTranslation.create({
                            data: {
                                quiz_badge_id: id,
                                locale: t.locale,
                                title: t.title,
                                created_at: new Date(),
                            },
                        });
                    }
                }
            }
        });

        await this.cache.invalidate(QUIZZES_INVALIDATE_PATTERN);
        const detail = await this.readRow(id);
        return apiResponse(1, 'updated', 'quiz_badges.updated', detail);
    }

    /**
     * Soft delete via is_active=false. Hard delete deferred — preserves results history
     * for admin oversight (T-06-78).
     */
    public async softDelete(id: number) {
        const existing: any = await this.prisma.quizBadge.findUnique({
            where: { id },
            select: { id: true },
        });
        if (!existing) throw new NotFoundException('quiz_badges.not_found');

        await this.prisma.quizBadge.update({
            where: { id },
            data: { is_active: false, updated_at: new Date() },
        });

        await this.cache.invalidate(QUIZZES_INVALIDATE_PATTERN);
        return apiResponse(1, 'deleted', 'quiz_badges.deleted', { id, is_active: false, deleted: true });
    }

    /**
     * Re-read a single badge row in the response shape used by list().
     */
    private async readRow(id: number) {
        const r: any = await this.prisma.quizBadge.findUnique({
            where: { id },
            include: {
                translations: { select: { locale: true, title: true } },
                _count: { select: { items: true, results: true } },
            },
        });
        if (!r) throw new NotFoundException('quiz_badges.not_found');
        return this.shapeRow(r);
    }

    private shapeRow(r: any) {
        const tlist = ((r.translations ?? []) as any[])
            .filter((t) => t.locale === 'ru' || t.locale === 'kz');
        return {
            id: Number(r.id),
            is_active: !!r.is_active,
            quiz_category_id: r.quiz_category_id == null ? null : Number(r.quiz_category_id),
            translations: {
                ru: tlist.find((t) => t.locale === 'ru')?.title ?? null,
                kz: tlist.find((t) => t.locale === 'kz')?.title ?? null,
            },
            item_count: Number(r._count?.items ?? 0),
            results_count: Number(r._count?.results ?? 0),
            created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
            updated_at:
                r.updated_at instanceof Date
                    ? r.updated_at.toISOString()
                    : (r.updated_at ?? null),
        };
    }
}
