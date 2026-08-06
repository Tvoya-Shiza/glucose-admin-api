/**
 * Инвариант непрерывности текстового блока (phase-52).
 *
 * Вопросы одного блока обязаны идти ПОДРЯД по `order`. В базе это выразить
 * нечем: `order` — обычное число без ограничений, и запретить чередование
 * блоков внешним ключом или индексом невозможно.
 *
 * Почему это не косметика. Ученик видит панель со стимульным текстом, пока
 * идёт по вопросам блока. Стоит вклинить между ними чужой вопрос — и панель
 * исчезнет, а затем появится снова. Именно это заказчик и описывал словами
 * «при неподвижности текста вопросы чередуются»: текст обязан стоять, пока
 * читаются его вопросы.
 *
 * Поэтому проверяем при каждом переупорядочивании и при привязке вопроса к
 * блоку, и отдаём понятную ошибку вместо молчаливой порчи теста.
 *
 * ОБЛАСТЬ ИНВАРИАНТА — ОДИН ТЕСТ. С phase-53 контекст стал общим справочником
 * и живёт сразу в нескольких тестах, но проверка от этого не меняется: ученик
 * проходит один тест за раз, и панель мигает внутри него. Формально —
 * «вопросы блока В ПРЕДЕЛАХ ОДНОГО ТЕСТА идут подряд».
 *
 * Отсюда требование к вызывающим: передавать вопросы РОВНО ОДНОГО теста. Если
 * сюда попадут вопросы двух тестов, один и тот же блок разойдётся по списку и
 * функция вернёт ложное нарушение — привязка окажется заблокирована без
 * причины. Все три вызова (привязка, reorder, импорт) выбирают по `quiz_id`.
 */

export interface PassageOrderedQuestion {
    id: number;
    order: number | null;
    passage_id: number | null;
}

export interface ContiguityViolation {
    passage_id: number;
    /** Позиции вопросов блока в итоговом порядке — видно, где именно разрыв. */
    positions: number[];
}

/**
 * Находит блоки, вопросы которых оказались разорваны.
 *
 * Список сначала сортируется тем же ключом, что и выдача ученику (`order`, при
 * равенстве — `id`): проверять надо ровно тот порядок, который увидит ученик, а
 * не тот, в котором строки пришли из базы.
 *
 * Вопросы без блока (`passage_id = null`) не проверяются — они самостоятельны и
 * могут стоять где угодно.
 */
export function findContiguityViolations(
    /** Вопросы РОВНО одного теста — см. область инварианта в шапке файла. */
    questionsOfSingleQuiz: ReadonlyArray<PassageOrderedQuestion>,
): ContiguityViolation[] {
    const sorted = [...questionsOfSingleQuiz].sort((a, b) => {
        const ao = a.order ?? Number.MAX_SAFE_INTEGER;
        const bo = b.order ?? Number.MAX_SAFE_INTEGER;
        return ao !== bo ? ao - bo : a.id - b.id;
    });

    const positions = new Map<number, number[]>();
    sorted.forEach((q, index) => {
        if (q.passage_id == null) return;
        const list = positions.get(q.passage_id) ?? [];
        list.push(index);
        positions.set(q.passage_id, list);
    });

    const violations: ContiguityViolation[] = [];
    for (const [passageId, list] of positions) {
        // Подряд идущие позиции дают разницу «последняя минус первая» ровно на
        // единицу меньше количества. Любой разрыв делает её больше.
        const span = list[list.length - 1] - list[0];
        if (span !== list.length - 1) {
            violations.push({ passage_id: passageId, positions: list });
        }
    }
    return violations;
}

/** Удобная обёртка: есть ли хоть один разрыв. */
export function isContiguous(questions: ReadonlyArray<PassageOrderedQuestion>): boolean {
    return findContiguityViolations(questions).length === 0;
}
