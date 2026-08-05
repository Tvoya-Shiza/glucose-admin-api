import { questionMaxPoints } from '@shared/quiz-scoring';

/**
 * Пересчёт `quizzes.total_mark` — максимума за тест.
 *
 * Колонка существует с самого начала и НЕ заполнялась никогда: ни один мутатор
 * вопросов её не трогал. При этом её читают:
 *
 *   - награда «за порог» (`QuizResultStoredEvent` в glucose-api) — из-за нуля
 *     она не выдавалась ни разу;
 *   - средний процент в профиле ученика — всегда показывал 0;
 *   - максимум колонки теста в рейтинг-журнале — колонки создавались с
 *     `max_score = 0`, из-за чего куратор не мог проставить оценку руками.
 *
 * Бэкфилл делает миграция phase-48; эта функция держит значение свежим дальше.
 * Вызывать ВНУТРИ той же транзакции, что и правку вопросов, — иначе между
 * вставкой вопроса и пересчётом остаётся окно с расходящимся максимумом.
 *
 * Тип транзакции намеренно структурный, а не `Prisma.TransactionClient`:
 * функцию зовут и из `$transaction`, и (в импорте) с самим PrismaService.
 */
export interface QuizTotalTx {
    quizQuestion: { findMany(args: any): Promise<Array<{ grade: number | null }>> };
    quizzes: { update(args: any): Promise<unknown> };
}

export async function recalcQuizTotal(tx: QuizTotalTx, quizId: number): Promise<number> {
    const questions = await tx.quizQuestion.findMany({
        where: { quiz_id: quizId },
        select: { grade: true },
    });
    // Считаем здесь, а не через SUM в базе: правило «минимум 1 балл за вопрос»
    // живёт в questionMaxPoints, и дублировать его в SQL значит завести седьмую
    // копию формулы — ровно то, что эта фаза убирает.
    const total = questions.reduce((sum, q) => sum + questionMaxPoints(q.grade), 0);
    await tx.quizzes.update({ where: { id: quizId }, data: { total_mark: total } });
    return total;
}
