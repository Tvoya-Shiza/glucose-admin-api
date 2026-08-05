import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { apiResponse } from '../../common/utils/api-response';
import type { ScopeActor } from '../../common/scoping/scope.types';
import {
    CreateQuizPassageDto,
    UpdateQuizPassageDto,
    type QuizPassageDto,
} from './dto/quiz-passage.dto';
import { QuizzesQuestionsService } from './quizzes-questions.service';
import { QuizzesCacheService } from './utils/quizzes-cache.service';
import { QUIZZES_INVALIDATE_PATTERN } from './utils/quizzes-cache';
import { sanitizeTiptapHtmlServer } from './utils/sanitize-html-server';
import { findContiguityViolations } from './utils/passage-contiguity';
import { nowSec } from './quizzes-mutations.service';

/**
 * Текстовые блоки теста (phase-52).
 *
 *   GET    /quizzes/:quizId/passages         — список блоков теста
 *   POST   /quizzes/:quizId/passages         — создать
 *   PATCH  /quizzes/:quizId/passages/:id     — изменить текст / заголовок / позицию
 *   DELETE /quizzes/:quizId/passages/:id     — удалить (вопросы становятся обычными)
 *   POST   /quizzes/:quizId/passages/:id/questions — привязать вопросы к блоку
 *
 * Инвариант непрерывности (вопросы блока идут подряд) проверяется при привязке;
 * см. `utils/passage-contiguity.ts` — почему он важен и почему в базе его нет.
 */
@Injectable()
export class QuizPassagesService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly cache: QuizzesCacheService,
        private readonly questionsService: QuizzesQuestionsService,
    ) {}

    public async list(actor: ScopeActor, quizId: number) {
        await this.questionsService.assertQuizScope(actor, quizId);
        const rows = await this.prisma.quizPassage.findMany({
            where: { quiz_id: quizId },
            orderBy: [{ position: 'asc' }, { id: 'asc' }],
            select: this.passageSelect(),
        });
        return apiResponse(1, 'retrieved', 'admin.quizzes.passages_retrieved', {
            passages: rows.map((r) => this.toDto(r)),
        });
    }

    public async create(actor: ScopeActor, quizId: number, dto: CreateQuizPassageDto) {
        await this.questionsService.assertQuizScope(actor, quizId);

        const created = await this.prisma.$transaction(async (tx) => {
            const passage = await tx.quizPassage.create({
                data: {
                    quiz_id: quizId,
                    position: dto.position ?? (await this.nextPosition(tx, quizId)),
                    image: dto.image ?? null,
                    created_at: nowSec(),
                },
                select: { id: true },
            });
            await tx.quizPassageTranslation.create({
                data: {
                    passage_id: passage.id,
                    locale: 'kz',
                    title: dto.title?.trim() || null,
                    body: sanitizeTiptapHtmlServer(dto.body) ?? '',
                },
            });
            return passage.id;
        });

        await this.cache.invalidate(QUIZZES_INVALIDATE_PATTERN);
        return apiResponse(1, 'created', 'admin.quizzes.passage_created', { passage: await this.readOne(quizId, created) });
    }

    public async update(actor: ScopeActor, quizId: number, id: number, dto: UpdateQuizPassageDto) {
        await this.questionsService.assertQuizScope(actor, quizId);
        await this.assertBelongs(quizId, id);

        await this.prisma.$transaction(async (tx) => {
            const data: Record<string, unknown> = { updated_at: nowSec() };
            if (dto.position !== undefined) data.position = dto.position;
            if (dto.image !== undefined) data.image = dto.image ?? null;
            await tx.quizPassage.update({ where: { id }, data });

            if (dto.title !== undefined || dto.body !== undefined) {
                // Уникальный индекс (passage_id, locale) стоит с самого начала,
                // поэтому upsert здесь безопасен — гонка упрётся в индекс, а не
                // породит вторую строку (в отличие от quiz_translations до phase-48).
                await tx.quizPassageTranslation.upsert({
                    where: { passage_id_locale: { passage_id: id, locale: 'kz' } },
                    create: {
                        passage_id: id,
                        locale: 'kz',
                        title: dto.title?.trim() || null,
                        body: dto.body ? (sanitizeTiptapHtmlServer(dto.body) ?? '') : '',
                    },
                    update: {
                        ...(dto.title !== undefined ? { title: dto.title?.trim() || null } : {}),
                        ...(dto.body !== undefined ? { body: sanitizeTiptapHtmlServer(dto.body) ?? '' } : {}),
                    },
                });
            }
        });

        await this.cache.invalidate(QUIZZES_INVALIDATE_PATTERN);
        return apiResponse(1, 'updated', 'admin.quizzes.passage_updated', { passage: await this.readOne(quizId, id) });
    }

    public async remove(actor: ScopeActor, quizId: number, id: number) {
        await this.questionsService.assertQuizScope(actor, quizId);
        await this.assertBelongs(quizId, id);

        // Вопросы не удаляются: внешний ключ на SET NULL превращает их в
        // обычные. Текст потерять не жалко, вопросы — жалко.
        await this.prisma.quizPassage.delete({ where: { id } });
        await this.cache.invalidate(QUIZZES_INVALIDATE_PATTERN);
        return apiResponse(1, 'deleted', 'admin.quizzes.passage_deleted', { id, deleted: true });
    }

    /**
     * Привязка набора вопросов к блоку (или отвязка, если `passageId` null).
     *
     * Проверяет инвариант непрерывности ПОСЛЕ применения и откатывает всё, если
     * он нарушен: вопросы блока обязаны идти подряд, иначе панель со стимульным
     * текстом будет исчезать и появляться посреди чтения.
     */
    public async assignQuestions(actor: ScopeActor, quizId: number, passageId: number | null, questionIds: number[]) {
        await this.questionsService.assertQuizScope(actor, quizId);
        if (passageId != null) await this.assertBelongs(quizId, passageId);

        await this.prisma.$transaction(async (tx) => {
            const owned = await tx.quizQuestion.findMany({
                where: { id: { in: questionIds }, quiz_id: quizId },
                select: { id: true },
            });
            if (owned.length !== questionIds.length) {
                throw new BadRequestException({
                    code: 'quizzes.passage_foreign_question',
                    message: 'quizzes.passage_foreign_question',
                });
            }

            await tx.quizQuestion.updateMany({
                where: { id: { in: questionIds }, quiz_id: quizId },
                data: { passage_id: passageId, updated_at: nowSec() },
            });

            const after = await tx.quizQuestion.findMany({
                where: { quiz_id: quizId },
                select: { id: true, order: true, passage_id: true },
            });
            const violations = findContiguityViolations(after);
            if (violations.length > 0) {
                // Транзакция откатится — тест останется в прежнем состоянии.
                throw new ConflictException({
                    code: 'quizzes.passage_not_contiguous',
                    message: 'quizzes.passage_not_contiguous',
                    violations,
                });
            }
        });

        await this.cache.invalidate(QUIZZES_INVALIDATE_PATTERN);
        return apiResponse(1, 'updated', 'admin.quizzes.passage_questions_assigned', {
            passage_id: passageId,
            question_ids: questionIds,
        });
    }

    private async nextPosition(tx: any, quizId: number): Promise<number> {
        const last = await tx.quizPassage.findFirst({
            where: { quiz_id: quizId },
            orderBy: [{ position: 'desc' }, { id: 'desc' }],
            select: { position: true },
        });
        return last ? Number(last.position) + 1 : 0;
    }

    private async assertBelongs(quizId: number, id: number): Promise<void> {
        const row = await this.prisma.quizPassage.findUnique({ where: { id }, select: { quiz_id: true } });
        if (!row || Number(row.quiz_id) !== quizId) {
            throw new NotFoundException({ code: 'quizzes.passage_not_found', message: 'quizzes.passage_not_found' });
        }
    }

    private passageSelect() {
        return {
            id: true,
            quiz_id: true,
            position: true,
            image: true,
            translations: { select: { locale: true, title: true, body: true } },
            _count: { select: { questions: true } },
        } as const;
    }

    private toDto(r: any): QuizPassageDto {
        const kz = (r.translations ?? []).find((t: any) => t.locale === 'kz') ?? r.translations?.[0];
        return {
            id: Number(r.id),
            quiz_id: Number(r.quiz_id),
            position: Number(r.position),
            title: kz?.title ?? null,
            body: kz?.body ?? '',
            image: r.image ?? null,
            question_count: r._count.questions,
        };
    }

    private async readOne(quizId: number, id: number): Promise<QuizPassageDto> {
        const r = await this.prisma.quizPassage.findUnique({ where: { id }, select: this.passageSelect() });
        if (!r || Number(r.quiz_id) !== quizId) {
            throw new NotFoundException({ code: 'quizzes.passage_not_found', message: 'quizzes.passage_not_found' });
        }
        return this.toDto(r);
    }
}
