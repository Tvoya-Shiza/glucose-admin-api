import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import type { Redis } from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';
import { apiResponse } from '../../common/utils/api-response';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { GradeAnswerDto } from './dto/grade-answer.dto';
import { buildResultsWhere } from './quizzes-results-where';
import { QuizzesCacheService } from './utils/quizzes-cache.service';
import { QUIZZES_INVALIDATE_PATTERN } from './utils/quizzes-cache';
import { questionMaxPoints, resolvePassThreshold } from '@shared/quiz-scoring';

interface EvaluatedAnswer {
    status: boolean | 'waiting';
    grade: number;
    answer?: unknown;
    options?: unknown;
}

export interface PendingAnswerDto {
    question_id: number;
    title_kz: string | null;
    /** Эталон, заданный методистом при создании вопроса. */
    correct_answer: string | null;
    /** Что написал ученик. */
    user_answer: string | null;
    status: 'waiting' | 'correct' | 'incorrect';
    grade: number;
    max_grade: number;
}

export interface ResultGradingDetailDto {
    id: number;
    user: { id: number; full_name: string | null; email: string | null } | null;
    quiz: { id: number; title_kz: string | null } | null;
    status: 'waiting' | 'passed' | 'failed';
    needs_grading: boolean;
    user_grade: number;
    max_grade: number;
    pass_mark: number;
    created_at: number;
    answers: PendingAnswerDto[];
}

/**
 * Phase 45 — ручная проверка развёрнутых ответов.
 *
 * Автопроверка засчитывает только точное совпадение с эталоном (мягкая сверка
 * живёт в glucose-api). Всё остальное остаётся со статусом 'waiting' внутри
 * JSON-поля `results` и ждёт преподавателя — раньше такие ответы висели вечно,
 * потому что ни экрана, ни эндпоинта для их оценки не существовало.
 *
 * Доступ сужается тем же `buildResultsWhere`, что и список результатов: и
 * куратор, и преподаватель видят только своих учеников.
 */
@Injectable()
export class QuizzesGradingService {
    private readonly logger = new Logger(QuizzesGradingService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly cache: QuizzesCacheService,
        @InjectRedis() private readonly redis: Redis,
    ) {}

    public async getResultDetail(actor: ScopeActor, resultId: number): Promise<ResultGradingDetailDto> {
        const row = await this.loadScopedResult(actor, resultId);
        const evaluated = this.parseResults(row.results);
        const questions = (row.quiz?.questions ?? []) as any[];

        let computedMax = 0;
        const answers: PendingAnswerDto[] = questions.map((q) => {
            const max = questionMaxPoints(q.grade);
            computedMax += max;

            const ev = evaluated[String(q.id)];
            const translations = (q.translations ?? []) as Array<{ locale: string; title: string | null; correct: string | null }>;
            const kz = translations.find((t) => t.locale === 'kz') ?? translations[0];

            return {
                question_id: Number(q.id),
                title_kz: kz?.title ?? null,
                correct_answer: q.type === 'descriptive' ? (kz?.correct ?? null) : null,
                user_answer: ev?.answer == null ? null : String(ev.answer),
                status: ev == null ? 'waiting' : ev.status === true ? 'correct' : ev.status === false ? 'incorrect' : 'waiting',
                grade: Number(ev?.grade ?? 0),
                max_grade: max,
            };
        });

        return {
            id: Number(row.id),
            user: row.user ? { id: Number(row.user.id), full_name: row.user.full_name ?? null, email: row.user.email ?? null } : null,
            quiz: row.quiz
                ? {
                      id: Number(row.quiz.id),
                      title_kz:
                          (row.quiz.translations as Array<{ locale: string; title: string | null }>).find((t) => t.locale === 'kz')
                              ?.title ?? null,
                  }
                : null,
            status: row.status,
            needs_grading: Boolean(row.needs_grading),
            user_grade: Number(row.user_grade ?? 0),
            // Снимок с момента сдачи; computedMax — только для попыток старше phase-48.
            max_grade: Number(row.max_grade ?? 0) || computedMax,
            pass_mark: Number(row.quiz?.pass_mark ?? 0),
            created_at: Number(row.created_at),
            answers,
        };
    }

    public async gradeAnswer(actor: ScopeActor, resultId: number, questionId: number, dto: GradeAnswerDto) {
        const row = await this.loadScopedResult(actor, resultId);
        const evaluated = this.parseResults(row.results);

        const question = ((row.quiz?.questions ?? []) as any[]).find((q) => Number(q.id) === questionId);
        if (!question) throw new NotFoundException('quizzes.question_not_found');
        if (question.type !== 'descriptive') {
            // Выбор из вариантов проверяется автоматически и однозначно —
            // ручное вмешательство означало бы подмену результата.
            throw new BadRequestException('quizzes.question_not_gradable');
        }

        const entry = evaluated[String(questionId)];
        if (!entry) throw new NotFoundException('quizzes.answer_not_found');

        const max = questionMaxPoints(question.grade);
        const isCorrect = dto.verdict === 'correct';
        evaluated[String(questionId)] = { ...entry, status: isCorrect, grade: isCorrect ? max : 0 };

        // Пересчитываем итог по всем ответам, а не правим дельтой: так результат
        // остаётся согласованным, даже если что-то правили до нас.
        const totalMark = Object.values(evaluated).reduce((sum, e) => sum + Number(e.grade ?? 0), 0);
        // Порог считаем тем же хелпером, что и автоматическая сдача: иначе
        // ручная проверка выносила бы другой вердикт при том же числе баллов.
        const maxGrade = Number(row.max_grade ?? 0) || (row.quiz?.questions ?? []).reduce(
            (sum: number, q: any) => sum + questionMaxPoints(q.grade), 0);
        const passThreshold = resolvePassThreshold(row.quiz?.pass_mark, row.quiz?.pass_mark_type, maxGrade);
        const stillWaiting = Object.values(evaluated).some((e) => e.status === 'waiting');

        await this.prisma.quizResult.update({
            where: { id: resultId },
            data: {
                results: JSON.stringify(evaluated),
                user_grade: totalMark,
                status: totalMark >= passThreshold ? 'passed' : 'failed',
                needs_grading: stillWaiting,
            },
        });

        await this.invalidate(Number(row.quiz_id), Number(row.user_id));

        return apiResponse(1, 'updated', 'quizzes.answer_graded', {
            id: resultId,
            question_id: questionId,
            verdict: dto.verdict,
            user_grade: totalMark,
            needs_grading: stillWaiting,
        });
    }

    /** Тот же предикат, что и у списка результатов, — доступ не расширяем. */
    private async loadScopedResult(actor: ScopeActor, resultId: number) {
        const { where, shortCircuit } = await buildResultsWhere(actor, {}, this.prisma);
        if (shortCircuit) throw new NotFoundException('quizzes.result_not_found');

        const row: any = await this.prisma.quizResult.findFirst({
            where: { ...where, id: resultId },
            select: {
                id: true,
                quiz_id: true,
                user_id: true,
                results: true,
                user_grade: true,
                max_grade: true,
                status: true,
                needs_grading: true,
                created_at: true,
                user: { select: { id: true, full_name: true, email: true } },
                quiz: {
                    select: {
                        id: true,
                        pass_mark: true,
                        pass_mark_type: true,
                        translations: { select: { locale: true, title: true } },
                        questions: {
                            select: {
                                id: true,
                                type: true,
                                grade: true,
                                translations: { select: { locale: true, title: true, correct: true } },
                            },
                        },
                    },
                },
            },
        });

        if (!row) throw new NotFoundException('quizzes.result_not_found');
        return row;
    }

    private parseResults(raw: string | null): Record<string, EvaluatedAnswer> {
        if (!raw) return {};
        try {
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (err) {
            this.logger.warn(`parseResults: битый JSON в quizzes_results: ${(err as Error).message}`);
            return {};
        }
    }

    /**
     * Ученик читает свой результат из кэша glucose-api. Тот процесс нам недоступен,
     * но Redis общий, поэтому ключ сбрасываем напрямую — иначе преподаватель
     * проверит ответ, а ученик увидит старую оценку до истечения TTL.
     */
    private async invalidate(quizId: number, userId: number) {
        await this.cache.invalidate(QUIZZES_INVALIDATE_PATTERN);
        try {
            await this.redis.del(`geonline:quiz_result:${quizId}:user:${userId}`);
            const keys = await this.redis.keys(`geonline:quiz*:${quizId}:user:${userId}*`);
            if (keys.length > 0) await this.redis.unlink(...keys);
        } catch (err) {
            this.logger.warn(`invalidate: не удалось сбросить кэш ученика: ${(err as Error).message}`);
        }
    }
}
