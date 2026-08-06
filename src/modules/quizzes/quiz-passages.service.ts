import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { apiResponse } from '../../common/utils/api-response';
import type { ScopeActor } from '../../common/scoping/scope.types';
import {
    CreateQuizPassageDto,
    ListQuizPassagesDto,
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
 * Контексты — общий справочник стимульных текстов (phase-52, отвязан в phase-53).
 *
 *   GET    /quiz-passages          — список с поиском по названию
 *   POST   /quiz-passages          — создать
 *   PATCH  /quiz-passages/:id      — изменить название / текст / картинку
 *   DELETE /quiz-passages/:id      — 409, пока есть привязанные вопросы
 *   POST   /quizzes/:quizId/passages/assign — привязать вопросы ТЕСТА к блоку
 *
 * Справочник общий: блок заводится один раз и подставляется в любой тест —
 * иначе поиск по названию, который просил заказчик, не имел бы смысла.
 * Скоупа нет, как и у справочника тем: это общий контент платформы.
 *
 * Привязка вопросов осталась вложенной в тест — она по природе относится к
 * тесту, там же и проверка непрерывности.
 *
 * Название блока — ТОЛЬКО для админки: заказчик просил его ради поиска. Ученику
 * оно не уходит (см. `glucose-api/…/utils/passage-payload.ts`).
 */
@Injectable()
export class QuizPassagesService {
    /** Потолок страницы: справочник листается, а не выгружается целиком. */
    private static readonly MAX_PER_PAGE = 100;

    constructor(
        private readonly prisma: PrismaService,
        private readonly cache: QuizzesCacheService,
        private readonly questionsService: QuizzesQuestionsService,
    ) {}

    public async list(query: ListQuizPassagesDto) {
        const perPage = Math.min(query.per_page ?? 20, QuizPassagesService.MAX_PER_PAGE);
        const page = query.page ?? 1;
        const q = query.q?.trim();

        // Поиск ИМЕННО по названию, не по телу: название заказчик и заводил
        // «для поиска», а стимульные тексты длинные, и совпадение в середине
        // отрывка выдало бы блок, который методист не узнает в списке.
        const where = q ? { translations: { some: { title: { contains: q } } } } : {};

        const [rows, total] = await Promise.all([
            this.prisma.quizPassage.findMany({
                where,
                // По убыванию id: у глобального справочника нет осмысленного
                // `position` — он остался от привязки к тесту.
                orderBy: [{ id: 'desc' }],
                skip: (page - 1) * perPage,
                take: perPage,
                select: this.passageSelect(),
            }),
            this.prisma.quizPassage.count({ where }),
        ]);

        return apiResponse(1, 'retrieved', 'admin.quizzes.passages_retrieved', {
            passages: rows.map((r) => this.toDto(r)),
            total,
            page,
            per_page: perPage,
            pageCount: Math.max(1, Math.ceil(total / perPage)),
        });
    }

    public async read(id: number) {
        return apiResponse(1, 'retrieved', 'admin.quizzes.passage_retrieved', { passage: await this.readOne(id) });
    }

    public async create(_actor: ScopeActor, dto: CreateQuizPassageDto) {
        const created = await this.prisma.$transaction(async (tx) => {
            const passage = await tx.quizPassage.create({
                data: {
                    // quiz_id больше не заполняем: блок ничьей собственностью не
                    // является. Колонка осталась только ради возможности отката.
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
        return apiResponse(1, 'created', 'admin.quizzes.passage_created', { passage: await this.readOne(created) });
    }

    public async update(_actor: ScopeActor, id: number, dto: UpdateQuizPassageDto) {
        await this.assertExists(id);

        await this.prisma.$transaction(async (tx) => {
            const data: Record<string, unknown> = { updated_at: nowSec() };
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
        return apiResponse(1, 'updated', 'admin.quizzes.passage_updated', { passage: await this.readOne(id) });
    }

    /**
     * Удаление блока, у которого есть вопросы, ЗАПРЕЩЕНО.
     *
     * В базе внешний ключ стоит на `SET NULL`, и для блока, принадлежавшего
     * одному тесту, это было милосердно: «текст потерять не жалко, вопросы —
     * жалко». Для общего справочника это уже тихое разрушение — методист
     * удаляет блок и обнуляет стимульный текст у вопросов ЧУЖИХ тестов, о
     * которых не знал. `SET NULL` остаётся страховкой на случай прямых правок
     * в базе, но через API так сделать нельзя.
     */
    public async remove(_actor: ScopeActor, id: number) {
        const usage = await this.usage(id);
        if (usage.question_count > 0) {
            throw new ConflictException({
                code: 'quizzes.passage_in_use',
                message: 'quizzes.passage_in_use',
                question_count: usage.question_count,
                quiz_count: usage.quiz_count,
            });
        }

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
     *
     * Проверки «блок принадлежит этому тесту» больше нет — в том и смысл общего
     * справочника. Осталась проверка, что все вопросы из ЭТОГО теста.
     */
    public async assignQuestions(actor: ScopeActor, quizId: number, passageId: number | null, questionIds: number[]) {
        await this.questionsService.assertQuizScope(actor, quizId);
        if (passageId != null) await this.assertExists(passageId);

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

            // Выборка ОБЯЗАНА быть по одному тесту: инвариант непрерывности
            // определён в пределах теста, и вопросы двух тестов дали бы ложное
            // срабатывание с заблокированной привязкой.
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

    /** Сколько вопросов и в скольких тестах используют блок. */
    private async usage(id: number): Promise<{ question_count: number; quiz_count: number }> {
        await this.assertExists(id);
        const rows = await this.prisma.quizQuestion.findMany({
            where: { passage_id: id },
            select: { quiz_id: true },
        });
        return { question_count: rows.length, quiz_count: new Set(rows.map((r) => r.quiz_id)).size };
    }

    private async assertExists(id: number): Promise<void> {
        const row = await this.prisma.quizPassage.findUnique({ where: { id }, select: { id: true } });
        if (!row) {
            throw new NotFoundException({ code: 'quizzes.passage_not_found', message: 'quizzes.passage_not_found' });
        }
    }

    private passageSelect() {
        return {
            id: true,
            image: true,
            translations: { select: { locale: true, title: true, body: true } },
            questions: { select: { quiz_id: true } },
        } as const;
    }

    private toDto(r: any): QuizPassageDto {
        const kz = (r.translations ?? []).find((t: any) => t.locale === 'kz') ?? r.translations?.[0];
        const questions: Array<{ quiz_id: number }> = r.questions ?? [];
        return {
            id: Number(r.id),
            title: kz?.title ?? null,
            body: kz?.body ?? '',
            image: r.image ?? null,
            question_count: questions.length,
            // Сколько тестов «держит» блок — это и показывается при попытке
            // удаления, чтобы методист понимал масштаб, а не видел голое 409.
            quiz_count: new Set(questions.map((q) => q.quiz_id)).size,
        };
    }

    private async readOne(id: number): Promise<QuizPassageDto> {
        const r = await this.prisma.quizPassage.findUnique({ where: { id }, select: this.passageSelect() });
        if (!r) {
            throw new NotFoundException({ code: 'quizzes.passage_not_found', message: 'quizzes.passage_not_found' });
        }
        return this.toDto(r);
    }
}
