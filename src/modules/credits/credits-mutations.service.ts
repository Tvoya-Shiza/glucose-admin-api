import {
    ConflictException,
    ForbiddenException,
    Injectable,
    NotFoundException,
    UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { apiResponse } from '../../common/utils/api-response';
import { buildScopeWhere } from '../../common/scoping/scope.helper';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { CREDIT_SCOPE_RULES } from './credits.scope';
import { CreateCreditDto } from './dto/create-credit.dto';
import { UpdateCreditDto } from './dto/update-credit.dto';
import { CreditsDetailService } from './credits-detail.service';
import { nowSec } from './utils/time';

/**
 * Write surface for Credit rows (contract §credits CRUD).
 *
 * Invariants enforced here:
 *   - chapter MUST belong to the course (422 credits.chapter_not_in_course)
 *   - every lesson_item_id MUST belong to the chapter (422 credits.items_not_in_chapter)
 *   - a non-admin creator MUST be the group's supervisor (403 credits.group_not_supervised)
 *   - DELETE is a soft delete; blocked while pending/in_progress sessions exist
 *     (409 credits.active_sessions)
 *   - PATCH lesson_item_ids REPLACES the link set diff-wise (stale links removed,
 *     new ones added; unchanged rows untouched)
 */
@Injectable()
export class CreditsMutationsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly detailService: CreditsDetailService,
    ) {}

    public async create(actor: ScopeActor, dto: CreateCreditDto) {
        await this.assertRefs(actor, {
            course_id: dto.course_id,
            chapter_id: dto.chapter_id,
            group_id: dto.group_id,
            lesson_item_ids: dto.lesson_item_ids ?? [],
        });

        const now = nowSec();
        const created = await this.prisma.credit.create({
            data: {
                course_id: dto.course_id,
                chapter_id: dto.chapter_id,
                group_id: dto.group_id,
                title: dto.title.trim(),
                description: dto.description ?? null,
                scheduled_at: dto.scheduled_at ?? null,
                created_by: actor.id,
                created_at: now,
                links: {
                    create: (dto.lesson_item_ids ?? []).map((itemId) => ({ chapter_item_id: itemId, created_at: now })),
                },
            },
            select: { id: true },
        });

        return apiResponse(1, 'created', 'admin.credits.created', { id: created.id });
    }

    public async update(actor: ScopeActor, id: bigint, dto: UpdateCreditDto) {
        const existing = await this.findWritable(actor, id);

        const course_id = dto.course_id ?? existing.course_id;
        const chapter_id = dto.chapter_id ?? existing.chapter_id;
        const group_id = dto.group_id ?? existing.group_id;

        const chapterChanged = chapter_id !== existing.chapter_id || course_id !== existing.course_id;
        await this.assertRefs(actor, {
            course_id,
            chapter_id,
            // Group re-checked only when it changes (the scope already proved the existing one).
            group_id: dto.group_id !== undefined && dto.group_id !== existing.group_id ? group_id : null,
            // On a chapter change every REMAINING link must belong to the new chapter too.
            lesson_item_ids: dto.lesson_item_ids ?? (chapterChanged ? existing.link_item_ids : []),
            chapter_membership_ids: chapterChanged && dto.lesson_item_ids === undefined ? existing.link_item_ids : undefined,
        });

        const now = nowSec();
        await this.prisma.$transaction(async (tx) => {
            await tx.credit.update({
                where: { id },
                data: {
                    course_id: dto.course_id,
                    chapter_id: dto.chapter_id,
                    group_id: dto.group_id,
                    title: dto.title === undefined ? undefined : dto.title.trim(),
                    description: dto.description === undefined ? undefined : dto.description,
                    scheduled_at: dto.scheduled_at === undefined ? undefined : dto.scheduled_at,
                    status: dto.status,
                    updated_at: now,
                },
            });

            if (dto.lesson_item_ids !== undefined) {
                const next = Array.from(new Set(dto.lesson_item_ids));
                const current = new Set(existing.link_item_ids);
                const toAdd = next.filter((itemId) => !current.has(itemId));
                const toRemove = existing.link_item_ids.filter((itemId) => !next.includes(itemId));

                if (toRemove.length > 0) {
                    await tx.creditLessonLink.deleteMany({ where: { credit_id: id, chapter_item_id: { in: toRemove } } });
                }
                if (toAdd.length > 0) {
                    await tx.creditLessonLink.createMany({
                        data: toAdd.map((itemId) => ({ credit_id: id, chapter_item_id: itemId, created_at: now })),
                    });
                }
            }
        });

        // The admin client writes this response straight into the detail cache
        // (setQueryData), so the payload must be the full GET-shaped detail —
        // same precedent as the conduct mutations returning fresh session state.
        return this.detailService.detail(actor, id);
    }

    public async remove(actor: ScopeActor, id: bigint) {
        await this.findWritable(actor, id);

        const activeSessions = await this.prisma.creditSession.count({
            where: { credit_id: id, status: { in: ['pending', 'in_progress'] } },
        });
        if (activeSessions > 0) {
            throw new ConflictException({
                code: 'credits.active_sessions',
                message: 'credits.active_sessions',
                active_sessions: activeSessions,
            });
        }

        await this.prisma.credit.update({ where: { id }, data: { deleted_at: nowSec() } });
        return apiResponse(1, 'deleted', 'admin.credits.deleted', { id, deleted: true });
    }

    // -------------------------------------------------------------- helpers

    private async findWritable(actor: ScopeActor, id: bigint) {
        const found = await this.prisma.credit.findFirst({
            where: { id, deleted_at: null, ...(buildScopeWhere(actor, CREDIT_SCOPE_RULES) as object) },
            select: { id: true, course_id: true, chapter_id: true, group_id: true, links: { select: { chapter_item_id: true } } },
        });
        if (!found) throw new NotFoundException({ code: 'credits.not_found', message: 'credits.not_found' });
        return {
            id: found.id,
            course_id: found.course_id,
            chapter_id: found.chapter_id,
            group_id: found.group_id,
            link_item_ids: found.links.map((l) => l.chapter_item_id),
        };
    }

    private async assertRefs(
        actor: ScopeActor,
        args: {
            course_id: number;
            chapter_id: number;
            /** null → skip the group check (unchanged group already proven by scope). */
            group_id: number | null;
            lesson_item_ids: number[];
            /** Extra membership-only re-check used when the chapter changes without a new link set. */
            chapter_membership_ids?: number[];
        },
    ): Promise<void> {
        const course = await this.prisma.webinar.findFirst({
            where: { id: args.course_id, deleted_at: null },
            select: { id: true },
        });
        if (!course) {
            throw new UnprocessableEntityException({ code: 'credits.course_not_found', message: 'credits.course_not_found' });
        }

        const chapter = await this.prisma.webinarChapter.findFirst({
            where: { id: args.chapter_id, webinar_id: args.course_id },
            select: { id: true },
        });
        if (!chapter) {
            throw new UnprocessableEntityException({ code: 'credits.chapter_not_in_course', message: 'credits.chapter_not_in_course' });
        }

        if (args.group_id != null) {
            const group = await this.prisma.group.findUnique({ where: { id: args.group_id }, select: { id: true, supervisor_id: true } });
            if (!group) {
                throw new UnprocessableEntityException({ code: 'credits.group_not_found', message: 'credits.group_not_found' });
            }
            // Curator (non-admin) must supervise the group they attach the credit to.
            if (actor.role_name !== 'admin' && group.supervisor_id !== actor.id) {
                throw new ForbiddenException({ code: 'credits.group_not_supervised', message: 'credits.group_not_supervised' });
            }
        }

        const itemIds = Array.from(new Set([...args.lesson_item_ids, ...(args.chapter_membership_ids ?? [])]));
        if (itemIds.length > 0) {
            const items = await this.prisma.webinarChapterItem.findMany({
                where: { id: { in: itemIds }, chapter_id: args.chapter_id },
                select: { id: true },
            });
            if (items.length !== itemIds.length) {
                const found = new Set(items.map((i) => i.id));
                throw new UnprocessableEntityException({
                    code: 'credits.items_not_in_chapter',
                    message: 'credits.items_not_in_chapter',
                    chapter_item_ids: itemIds.filter((itemId) => !found.has(itemId)),
                });
            }
        }
    }
}
