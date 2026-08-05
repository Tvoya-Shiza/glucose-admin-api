import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { apiResponse } from '../../common/utils/api-response';
import type { ScopeActor } from '../../common/scoping/scope.types';
import {
    CreateQuizTopicDto,
    ListQuizTopicsDto,
    UpdateQuizTopicDto,
    type QuizTopicNode,
} from './dto/quiz-topic.dto';
import { nowSec } from './quizzes-mutations.service';

/**
 * Справочник тем тестов (phase-51).
 *
 *   GET    /quiz-topics       — плоский список; дерево собирает клиент
 *   POST   /quiz-topics       — создать корневую или вложенную
 *   PATCH  /quiz-topics/:id   — переименовать / перенести / переставить / архивировать
 *   DELETE /quiz-topics/:id   — 409, пока есть дети или вопросы
 *
 * Клон `CreditTopicsService` (phase-34) с двумя отличиями: id — числа, а не
 * BigInt-строки, и нет привязки к курсу. Логика защиты от циклов повторена
 * один в один — она уже проверена на зачётах.
 *
 * Скоупа нет намеренно: справочник тем — общий контент платформы, как и у
 * зачётов. Право на правку решает `@RequirePermission`.
 */
@Injectable()
export class QuizTopicsService {
    /**
     * Потолок глубины при проверке цикла. Нужен не для ограничения иерархии, а
     * чтобы битые данные (взаимно ссылающиеся темы) всплывали ошибкой, а не
     * вешали запрос навсегда.
     */
    private static readonly CYCLE_HOP_CAP = 100;

    constructor(private readonly prisma: PrismaService) {}

    public async list(query: ListQuizTopicsDto) {
        const where = query.include_archived ? {} : { status: 'active' as const };
        const rows = await this.prisma.quizTopic.findMany({
            where,
            orderBy: [{ position: 'asc' }, { id: 'asc' }],
            select: this.nodeSelect(),
        });
        return apiResponse(1, 'retrieved', 'admin.quizzes.topics_retrieved', {
            topics: rows.map((r) => this.toNode(r)),
        });
    }

    public async create(actor: ScopeActor, dto: CreateQuizTopicDto) {
        const parentId = dto.parent_id ?? null;
        if (parentId != null) {
            const parent = await this.prisma.quizTopic.findUnique({ where: { id: parentId }, select: { id: true } });
            if (!parent) {
                throw new BadRequestException({ code: 'quizzes.topic_parent_not_found', message: 'quizzes.topic_parent_not_found' });
            }
        }

        const created = await this.prisma.quizTopic.create({
            data: {
                parent_id: parentId,
                name: dto.name.trim(),
                position: dto.position ?? 0,
                created_by: actor.id,
                created_at: nowSec(),
            },
            select: { id: true },
        });

        return apiResponse(1, 'created', 'admin.quizzes.topic_created', { topic: await this.readNode(created.id) });
    }

    public async update(id: number, dto: UpdateQuizTopicDto) {
        const existing = await this.prisma.quizTopic.findUnique({ where: { id }, select: { id: true, parent_id: true } });
        if (!existing) throw new NotFoundException({ code: 'quizzes.topic_not_found', message: 'quizzes.topic_not_found' });

        const data: Record<string, unknown> = { updated_at: nowSec() };
        if (dto.name !== undefined) data.name = dto.name.trim();
        if (dto.position !== undefined) data.position = dto.position;
        if (dto.status !== undefined) data.status = dto.status;

        if (dto.parent_id !== undefined) {
            const newParentId = dto.parent_id ?? null;
            if (newParentId != null && newParentId !== existing.parent_id) {
                if (newParentId === id) {
                    throw new BadRequestException({ code: 'quizzes.topic_cycle', message: 'quizzes.topic_cycle' });
                }
                await this.assertNoCycle(id, newParentId);
            }
            data.parent_id = newParentId;
        }

        await this.prisma.quizTopic.update({ where: { id }, data });
        return apiResponse(1, 'updated', 'admin.quizzes.topic_updated', { topic: await this.readNode(id) });
    }

    public async remove(id: number) {
        const existing = await this.prisma.quizTopic.findUnique({
            where: { id },
            select: { id: true, _count: { select: { children: true, questions: true } } },
        });
        if (!existing) throw new NotFoundException({ code: 'quizzes.topic_not_found', message: 'quizzes.topic_not_found' });

        // Тема с вопросами удаляется только осознанно: внешний ключ стоит на
        // SET NULL, то есть молчаливое удаление обезличило бы разбор по темам у
        // всех прошлых результатов. Поэтому 409 с числами — пусть методист
        // сначала увидит, что именно он теряет.
        if (existing._count.children > 0 || existing._count.questions > 0) {
            throw new ConflictException({
                code: 'quizzes.topic_not_empty',
                message: 'quizzes.topic_not_empty',
                child_count: existing._count.children,
                question_count: existing._count.questions,
            });
        }

        await this.prisma.quizTopic.delete({ where: { id } });
        return apiResponse(1, 'deleted', 'admin.quizzes.topic_deleted', { id, deleted: true });
    }

    /**
     * Защита от цикла при переносе: идём ВВЕРХ от нового родителя по parent_id.
     * Наткнулись на себя — значит новый родитель является потомком.
     */
    private async assertNoCycle(selfId: number, startParentId: number): Promise<void> {
        let cursor: number | null = startParentId;
        for (let hops = 0; hops < QuizTopicsService.CYCLE_HOP_CAP; hops++) {
            if (cursor == null) return; // дошли до корня — цикла нет
            if (cursor === selfId) {
                throw new BadRequestException({ code: 'quizzes.topic_cycle', message: 'quizzes.topic_cycle' });
            }
            const parent: { parent_id: number | null } | null = await this.prisma.quizTopic.findUnique({
                where: { id: cursor },
                select: { parent_id: true },
            });
            if (!parent) {
                throw new BadRequestException({ code: 'quizzes.topic_parent_not_found', message: 'quizzes.topic_parent_not_found' });
            }
            cursor = parent.parent_id;
        }
        throw new BadRequestException({ code: 'quizzes.topic_depth_overflow', message: 'quizzes.topic_depth_overflow' });
    }

    private nodeSelect() {
        return {
            id: true,
            parent_id: true,
            name: true,
            position: true,
            status: true,
            _count: { select: { questions: true, children: true } },
        } as const;
    }

    private toNode(r: any): QuizTopicNode {
        return {
            id: Number(r.id),
            parent_id: r.parent_id == null ? null : Number(r.parent_id),
            name: r.name,
            position: Number(r.position),
            status: r.status,
            question_count: r._count.questions,
            child_count: r._count.children,
        };
    }

    private async readNode(id: number): Promise<QuizTopicNode> {
        const r = await this.prisma.quizTopic.findUnique({ where: { id }, select: this.nodeSelect() });
        if (!r) throw new NotFoundException({ code: 'quizzes.topic_not_found', message: 'quizzes.topic_not_found' });
        return this.toNode(r);
    }
}
