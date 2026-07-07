import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { apiResponse } from '../../common/utils/api-response';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { CreateCreditTopicDto } from './dto/create-credit-topic.dto';
import { ListCreditTopicsDto } from './dto/list-credit-topics.dto';
import { UpdateCreditTopicDto } from './dto/update-credit-topic.dto';
import type { CreditTopicNode } from './types/credits.types';
import { parseBigIntId } from './utils/ids';
import { nowSec } from './utils/time';

/**
 * Credit topics — standalone shared tree (contract decision 2: NOT bound to the
 * course structure; no per-actor scope — bank/topics are shared content).
 *
 *   GET    /credit-topics                — flat adjacency list (client builds the tree)
 *   POST   /credit-topics                — create (root or child)
 *   PATCH  /credit-topics/:id            — rename / move (ancestor cycle check) / reorder / archive
 *   DELETE /credit-topics/:id            — 409 while children or questions exist (FK RESTRICT backs it)
 */
@Injectable()
export class CreditTopicsService {
    private static readonly CYCLE_HOP_CAP = 100;

    constructor(private readonly prisma: PrismaService) {}

    public async list(query: ListCreditTopicsDto) {
        const where = query.include_archived ? {} : { status: 'active' as const };
        const rows = await this.prisma.creditTopic.findMany({
            where,
            orderBy: [{ position: 'asc' }, { id: 'asc' }],
            select: {
                id: true,
                parent_id: true,
                name: true,
                position: true,
                status: true,
                _count: { select: { questions: true, children: true } },
            },
        });
        const topics: CreditTopicNode[] = rows.map((r) => ({
            id: r.id,
            parent_id: r.parent_id,
            name: r.name,
            position: r.position,
            status: r.status,
            question_count: r._count.questions,
            child_count: r._count.children,
        }));
        return apiResponse(1, 'retrieved', 'admin.credits.topics_retrieved', { topics });
    }

    public async create(actor: ScopeActor, dto: CreateCreditTopicDto) {
        const parentId = dto.parent_id == null ? null : parseBigIntId(dto.parent_id, 'parent_id');
        if (parentId != null) {
            const parent = await this.prisma.creditTopic.findUnique({ where: { id: parentId }, select: { id: true } });
            if (!parent) {
                throw new BadRequestException({ code: 'credits.topic_parent_not_found', message: 'credits.topic_parent_not_found' });
            }
        }

        const created = await this.prisma.creditTopic.create({
            data: {
                parent_id: parentId,
                name: dto.name.trim(),
                position: dto.position ?? 0,
                created_by: actor.id,
                created_at: nowSec(),
            },
            select: { id: true },
        });

        const topic = await this.readNode(created.id);
        return apiResponse(1, 'created', 'admin.credits.topic_created', { topic });
    }

    public async update(id: bigint, dto: UpdateCreditTopicDto) {
        const existing = await this.prisma.creditTopic.findUnique({ where: { id }, select: { id: true, parent_id: true } });
        if (!existing) throw new NotFoundException({ code: 'credits.topic_not_found', message: 'credits.topic_not_found' });

        const data: Record<string, unknown> = { updated_at: nowSec() };
        if (dto.name !== undefined) data.name = dto.name.trim();
        if (dto.position !== undefined) data.position = dto.position;
        if (dto.status !== undefined) data.status = dto.status;

        if (dto.parent_id !== undefined) {
            const newParentId = dto.parent_id == null ? null : parseBigIntId(dto.parent_id, 'parent_id');
            if (newParentId != null && newParentId !== existing.parent_id) {
                if (newParentId === id) {
                    throw new BadRequestException({ code: 'credits.topic_cycle', message: 'credits.topic_cycle' });
                }
                await this.assertNoCycle(id, newParentId);
            }
            data.parent_id = newParentId;
        }

        await this.prisma.creditTopic.update({ where: { id }, data });

        const topic = await this.readNode(id);
        return apiResponse(1, 'updated', 'admin.credits.topic_updated', { topic });
    }

    public async remove(id: bigint) {
        const existing = await this.prisma.creditTopic.findUnique({
            where: { id },
            select: { id: true, _count: { select: { children: true, questions: true } } },
        });
        if (!existing) throw new NotFoundException({ code: 'credits.topic_not_found', message: 'credits.topic_not_found' });

        if (existing._count.children > 0 || existing._count.questions > 0) {
            throw new ConflictException({
                code: 'credits.topic_not_empty',
                message: 'credits.topic_not_empty',
                child_count: existing._count.children,
                question_count: existing._count.questions,
            });
        }

        try {
            await this.prisma.creditTopic.delete({ where: { id } });
        } catch (err) {
            // Belt-and-braces: a child/question created between the count and the delete
            // trips the FK RESTRICT (P2003) — surface the same 409 as the pre-check.
            if ((err as { code?: string })?.code === 'P2003') {
                throw new ConflictException({ code: 'credits.topic_not_empty', message: 'credits.topic_not_empty' });
            }
            throw err;
        }

        return apiResponse(1, 'deleted', 'admin.credits.topic_deleted', { id, deleted: true });
    }

    /**
     * Cycle protection when re-parenting: walk UP from the new parent following
     * parent_id pointers; hitting `selfId` means the new parent is a descendant.
     * A hop cap surfaces corrupted data instead of spinning forever.
     */
    private async assertNoCycle(selfId: bigint, startParentId: bigint): Promise<void> {
        let cursor: bigint | null = startParentId;
        for (let hops = 0; hops < CreditTopicsService.CYCLE_HOP_CAP; hops++) {
            if (cursor == null) return; // reached a root — no cycle
            if (cursor === selfId) {
                throw new BadRequestException({ code: 'credits.topic_cycle', message: 'credits.topic_cycle' });
            }
            const parent: { parent_id: bigint | null } | null = await this.prisma.creditTopic.findUnique({
                where: { id: cursor },
                select: { parent_id: true },
            });
            if (!parent) {
                throw new BadRequestException({ code: 'credits.topic_parent_not_found', message: 'credits.topic_parent_not_found' });
            }
            cursor = parent.parent_id;
        }
        throw new BadRequestException({ code: 'credits.topic_depth_overflow', message: 'credits.topic_depth_overflow' });
    }

    private async readNode(id: bigint): Promise<CreditTopicNode> {
        const r = await this.prisma.creditTopic.findUnique({
            where: { id },
            select: {
                id: true,
                parent_id: true,
                name: true,
                position: true,
                status: true,
                _count: { select: { questions: true, children: true } },
            },
        });
        if (!r) throw new NotFoundException({ code: 'credits.topic_not_found', message: 'credits.topic_not_found' });
        return {
            id: r.id,
            parent_id: r.parent_id,
            name: r.name,
            position: r.position,
            status: r.status,
            question_count: r._count.questions,
            child_count: r._count.children,
        };
    }
}
