import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { apiResponse } from '../../common/utils/api-response';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { QuizzesQuestionsService } from './quizzes-questions.service';
import { QuizzesCacheService } from './utils/quizzes-cache.service';
import { QUIZZES_INVALIDATE_PATTERN, QUIZ_RESULT_PUBLIC_INVALIDATE_PATTERN } from './utils/quizzes-cache';
import { BulkTopicDto } from './dto/bulk-topic.dto';
import { nowSec } from './quizzes-mutations.service';

/**
 * Массовая простановка темы вопросам теста (phase-55).
 *
 * ВЕРСИЯ ТЕСТА НЕ ПОДНИМАЕТСЯ, и force-confirm не включается. Это не
 * послабление, а следование тому, как проект уже трактует тему: в
 * `updateQuestion` список изменившихся полей собирается только из типа и
 * переводов — `topic_id` в него не входит. Тема не меняет ни формулировку, ни
 * варианты, ни баллы, поэтому открытая попытка ученика от неё не ломается.
 * Наоборот, бамп версии при разметке тысячи вопросов гарантированно обесценил
 * бы все попытки, идущие в этот момент.
 */
@Injectable()
export class QuizzesQuestionsBulkService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly cache: QuizzesCacheService,
        private readonly questionsService: QuizzesQuestionsService,
    ) {}

    public async assignTopic(actor: ScopeActor, quizId: number, dto: BulkTopicDto) {
        await this.questionsService.assertQuizScope(actor, quizId);

        const topicId = dto.topic_id ?? null;
        if (topicId != null) {
            const topic = await this.prisma.quizTopic.findFirst({
                where: { id: topicId, status: 'active' },
                select: { id: true },
            });
            if (!topic) {
                throw new NotFoundException({ code: 'quizzes.topic_not_found', message: 'quizzes.topic_not_found' });
            }
        }

        // Все вопросы обязаны принадлежать ЭТОМУ тесту — та же защита от
        // кросс-тестового вмешательства, что и в правке одного вопроса.
        const owned = await this.prisma.quizQuestion.findMany({
            where: { id: { in: dto.question_ids }, quiz_id: quizId },
            select: { id: true },
        });
        if (owned.length !== dto.question_ids.length) {
            throw new BadRequestException({
                code: 'quizzes.question_not_in_quiz',
                message: 'quizzes.question_not_in_quiz',
            });
        }

        const updated = await this.prisma.quizQuestion.updateMany({
            where: { id: { in: dto.question_ids }, quiz_id: quizId },
            data: { topic_id: topicId, updated_at: nowSec() },
        });

        await this.cache.invalidate(QUIZZES_INVALIDATE_PATTERN);
        // Разбор результата у ученика кэшируется на 30 минут в ЧУЖОМ
        // неймспейсе. Без сброса методист разметит темы, откроет результат и
        // решит, что ничего не работает.
        await this.cache.invalidate(QUIZ_RESULT_PUBLIC_INVALIDATE_PATTERN);

        return apiResponse(1, 'updated', 'admin.quizzes.questions_topic_assigned', {
            affected: updated.count,
            topic_id: topicId,
        });
    }
}
