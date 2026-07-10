import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { apiResponse } from '../../common/utils/api-response';
import type { ScopeActor } from '../../common/scoping/scope.types';
import type { CreditDifficulty } from '@shared/credits';
import { CreditsListService } from './credits-list.service';
import { CreateCreditQuestionDto } from './dto/create-credit-question.dto';
import { ListCreditQuestionsDto } from './dto/list-credit-questions.dto';
import { UpdateCreditQuestionDto } from './dto/update-credit-question.dto';
import type { CreditQuestionRow } from './types/credits.types';
import { parseBigIntId } from './utils/ids';
import { nowSec } from './utils/time';

/**
 * Credit question bank (contract §credit-questions). Shared content — no data
 * scope; permission gating only (credits.view reads / credits.questions_manage
 * writes / DELETE admin-only at the controller).
 *
 * Snapshots in credit_session_questions are authoritative (decision 6), so
 * editing or deleting a bank question NEVER touches already-generated sessions
 * (question_id FK is SetNull on delete).
 */
@Injectable()
export class CreditQuestionsService {
    private static readonly DEFAULT_PAGE_SIZE = 50;
    private static readonly MAX_PAGE_SIZE = 200;

    constructor(
        private readonly prisma: PrismaService,
        private readonly listService: CreditsListService,
    ) {}

    public async list(query: ListCreditQuestionsDto) {
        const page = Math.max(1, query.page ?? 1);
        const page_size = Math.min(
            CreditQuestionsService.MAX_PAGE_SIZE,
            Math.max(1, query.page_size ?? CreditQuestionsService.DEFAULT_PAGE_SIZE),
        );

        const where: any = {};
        if (query.topic_id !== undefined) {
            const rootId = parseBigIntId(query.topic_id, 'topic_id');
            where.topic_id = query.include_descendants ? { in: await this.expandSubtree(rootId) } : rootId;
        }
        if (query.difficulty) where.difficulty = query.difficulty;
        if (query.status) where.status = query.status;
        if (query.search && query.search.trim().length > 0) {
            const needle = query.search.trim();
            where.OR = [{ question: { contains: needle } }, { answer: { contains: needle } }];
        }

        const [total, raw] = await this.prisma.$transaction([
            this.prisma.creditQuestion.count({ where }),
            this.prisma.creditQuestion.findMany({
                where,
                orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
                take: page_size,
                skip: (page - 1) * page_size,
                select: this.rowSelect(),
            }),
        ]);

        return {
            rows: raw.map((r) => this.mapRow(r)),
            total,
            pageCount: Math.max(1, Math.ceil(total / page_size)),
        };
    }

    /**
     * GET /credit-questions/availability?topic_ids=1,2,3 — per-topic A/B/C counts
     * of ACTIVE questions (feeds the wizard's deficit preview).
     */
    public async availability(topicIdsRaw: string) {
        const topicIds = Array.from(new Set(topicIdsRaw.split(','))).map((raw) => parseBigIntId(raw, 'topic_ids'));

        const grouped = await this.prisma.creditQuestion.groupBy({
            by: ['topic_id', 'difficulty'],
            where: { topic_id: { in: topicIds }, status: 'active' },
            _count: { _all: true },
        });

        const byTopic = new Map<string, { A: number; B: number; C: number }>();
        for (const id of topicIds) byTopic.set(id.toString(), { A: 0, B: 0, C: 0 });
        for (const g of grouped) {
            const counts = byTopic.get(g.topic_id.toString());
            if (counts) counts[g.difficulty as CreditDifficulty] = g._count._all;
        }

        const availability = topicIds.map((id) => ({ topic_id: id, counts: byTopic.get(id.toString())! }));
        return apiResponse(1, 'retrieved', 'admin.credits.availability_retrieved', { availability });
    }

    public async create(actor: ScopeActor, dto: CreateCreditQuestionDto) {
        const topicId = await this.resolveTargetTopicId(actor, dto.topic_id, dto.chapter_item_id);

        const created = await this.prisma.creditQuestion.create({
            data: {
                topic_id: topicId,
                difficulty: dto.difficulty,
                question: dto.question,
                answer: dto.answer,
                score: dto.score ?? 1,
                created_by: actor.id,
                created_at: nowSec(),
            },
            select: { id: true },
        });

        const question = await this.readRow(created.id);
        return apiResponse(1, 'created', 'admin.credits.question_created', { question });
    }

    public async update(actor: ScopeActor, id: bigint, dto: UpdateCreditQuestionDto) {
        const existing = await this.prisma.creditQuestion.findUnique({ where: { id }, select: { id: true } });
        if (!existing) throw new NotFoundException({ code: 'credits.question_not_found', message: 'credits.question_not_found' });

        const data: Record<string, unknown> = { updated_at: nowSec() };
        // Re-tag only when a new target is supplied; the helper rejects both-at-once.
        if (dto.topic_id !== undefined || dto.chapter_item_id !== undefined) {
            data.topic_id = await this.resolveTargetTopicId(actor, dto.topic_id, dto.chapter_item_id);
        }
        if (dto.difficulty !== undefined) data.difficulty = dto.difficulty;
        if (dto.question !== undefined) data.question = dto.question;
        if (dto.answer !== undefined) data.answer = dto.answer;
        if (dto.score !== undefined) data.score = dto.score;
        if (dto.status !== undefined) data.status = dto.status;

        await this.prisma.creditQuestion.update({ where: { id }, data });

        const question = await this.readRow(id);
        return apiResponse(1, 'updated', 'admin.credits.question_updated', { question });
    }

    public async remove(id: bigint) {
        const existing = await this.prisma.creditQuestion.findUnique({ where: { id }, select: { id: true } });
        if (!existing) throw new NotFoundException({ code: 'credits.question_not_found', message: 'credits.question_not_found' });

        try {
            // Session snapshots keep their copied text/answer/score; their question_id
            // provenance FK is ON DELETE SET NULL, so history survives the delete.
            await this.prisma.creditQuestion.delete({ where: { id } });
        } catch (err) {
            if ((err as { code?: string })?.code === 'P2003') {
                throw new ConflictException({ code: 'credits.question_in_use', message: 'credits.question_in_use' });
            }
            throw err;
        }

        return apiResponse(1, 'deleted', 'admin.credits.question_deleted', { id, deleted: true });
    }

    // -------------------------------------------------------------- helpers

    /**
     * Expands a topic subtree in memory: one findMany over ALL topics (the tree is
     * small — hundreds of rows), then BFS over the parent_id adjacency list.
     */
    private async expandSubtree(rootId: bigint): Promise<bigint[]> {
        const all = await this.prisma.creditTopic.findMany({ select: { id: true, parent_id: true } });
        const childrenOf = new Map<string, bigint[]>();
        for (const t of all) {
            if (t.parent_id == null) continue;
            const key = t.parent_id.toString();
            const bucket = childrenOf.get(key);
            if (bucket) bucket.push(t.id);
            else childrenOf.set(key, [t.id]);
        }

        const result: bigint[] = [];
        const seen = new Set<string>();
        const queue: bigint[] = [rootId];
        while (queue.length > 0) {
            const cursor = queue.shift()!;
            const key = cursor.toString();
            if (seen.has(key)) continue; // defensive: corrupted data cannot loop us
            seen.add(key);
            result.push(cursor);
            for (const child of childrenOf.get(key) ?? []) queue.push(child);
        }
        return result;
    }

    private async assertTopicExists(topicId: bigint): Promise<void> {
        const topic = await this.prisma.creditTopic.findUnique({ where: { id: topicId }, select: { id: true } });
        if (!topic) {
            throw new BadRequestException({ code: 'credits.topic_not_found', message: 'credits.topic_not_found' });
        }
    }

    /**
     * Resolves the credit_topics.id a question should hang off, from EXACTLY ONE
     * of `topic_id` (an existing custom topic) or `chapter_item_id` (a course
     * lesson — its lesson-topic is materialized/reused lazily). Rejects
     * zero-or-both so `credit_questions.topic_id` always ends up non-null.
     */
    private async resolveTargetTopicId(
        actor: ScopeActor,
        topicIdRaw: string | undefined,
        chapterItemId: number | undefined,
    ): Promise<bigint> {
        const hasTopic = topicIdRaw !== undefined;
        const hasLesson = chapterItemId !== undefined;
        if (hasTopic && hasLesson) {
            throw new BadRequestException({ code: 'credits.topic_or_lesson', message: 'credits.topic_or_lesson' });
        }
        if (hasTopic) {
            const topicId = parseBigIntId(topicIdRaw, 'topic_id');
            await this.assertTopicExists(topicId);
            return topicId;
        }
        if (hasLesson) {
            return this.resolveLessonTopicId(actor, chapterItemId!);
        }
        throw new BadRequestException({ code: 'credits.topic_required', message: 'credits.topic_required' });
    }

    /**
     * Find-or-create the lesson-backed topic for a course lesson. The lesson-topic
     * is a normal credit_topics row with `chapter_item_id` set, `course_id`
     * denormalized from the lesson's chapter, and `name` snapshotted from the
     * lesson title at attach time. Concurrent first-saves race on the
     * `uniq_ct_chapter_item` unique key — the P2002 branch re-reads the winner.
     */
    private async resolveLessonTopicId(actor: ScopeActor, chapterItemId: number): Promise<bigint> {
        const existing = await this.prisma.creditTopic.findFirst({
            where: { chapter_item_id: chapterItemId },
            select: { id: true },
        });
        if (existing) return existing.id;

        const item = await this.prisma.webinarChapterItem.findUnique({
            where: { id: chapterItemId },
            select: { id: true, webinar_chapter: { select: { webinar_id: true } } },
        });
        if (!item) {
            throw new BadRequestException({ code: 'credits.lesson_not_found', message: 'credits.lesson_not_found' });
        }

        const titles = await this.listService.resolveChapterItemTitles([chapterItemId]);
        const name = (titles.get(chapterItemId) ?? '').trim() || `#${chapterItemId}`;

        try {
            const created = await this.prisma.creditTopic.create({
                data: {
                    parent_id: null,
                    course_id: item.webinar_chapter.webinar_id,
                    chapter_item_id: chapterItemId,
                    name,
                    position: 0,
                    created_by: actor.id,
                    created_at: nowSec(),
                },
                select: { id: true },
            });
            return created.id;
        } catch (err) {
            // Lost the race — the unique key already holds the lesson-topic.
            if ((err as { code?: string })?.code === 'P2002') {
                const won = await this.prisma.creditTopic.findFirst({
                    where: { chapter_item_id: chapterItemId },
                    select: { id: true },
                });
                if (won) return won.id;
            }
            throw err;
        }
    }

    private rowSelect() {
        return {
            id: true,
            difficulty: true,
            question: true,
            answer: true,
            score: true,
            status: true,
            created_at: true,
            updated_at: true,
            topic: { select: { id: true, name: true, course_id: true, chapter_item_id: true } },
        };
    }

    private mapRow(r: any): CreditQuestionRow {
        return {
            id: r.id,
            topic: {
                id: r.topic.id,
                name: r.topic.name,
                course_id: r.topic.course_id ?? null,
                chapter_item_id: r.topic.chapter_item_id ?? null,
            },
            difficulty: r.difficulty,
            question: r.question,
            answer: r.answer,
            score: r.score,
            status: r.status,
            created_at: r.created_at,
            updated_at: r.updated_at,
        };
    }

    private async readRow(id: bigint): Promise<CreditQuestionRow> {
        const r = await this.prisma.creditQuestion.findUnique({ where: { id }, select: this.rowSelect() });
        if (!r) throw new NotFoundException({ code: 'credits.question_not_found', message: 'credits.question_not_found' });
        return this.mapRow(r);
    }
}
