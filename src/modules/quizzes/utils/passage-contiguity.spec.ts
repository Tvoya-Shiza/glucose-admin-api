import { findContiguityViolations, isContiguous } from './passage-contiguity';

/**
 * Непрерывность текстового блока (phase-52).
 *
 * Инвариант в базе не выражается, поэтому вся его защита — этот файл и вызовы
 * из мутаторов. Если тесты отсюда исчезнут, ученик начнёт видеть, как панель со
 * стимульным текстом пропадает и возвращается посреди блока.
 */

const q = (id: number, order: number | null, passageId: number | null) => ({ id, order, passage_id: passageId });

describe('findContiguityViolations', () => {
    it('вопросы блока подряд — нарушений нет', () => {
        expect(isContiguous([q(1, 1, 10), q(2, 2, 10), q(3, 3, null)])).toBe(true);
    });

    it('чужой вопрос посреди блока — нарушение', () => {
        const violations = findContiguityViolations([q(1, 1, 10), q(2, 2, null), q(3, 3, 10)]);
        expect(violations).toHaveLength(1);
        expect(violations[0].passage_id).toBe(10);
        expect(violations[0].positions).toEqual([0, 2]);
    });

    it('два блока подряд — это нормально, они не смешаны', () => {
        expect(isContiguous([q(1, 1, 10), q(2, 2, 10), q(3, 3, 20), q(4, 4, 20)])).toBe(true);
    });

    it('переплетённые блоки — нарушение у обоих', () => {
        const violations = findContiguityViolations([q(1, 1, 10), q(2, 2, 20), q(3, 3, 10), q(4, 4, 20)]);
        expect(violations.map((v) => v.passage_id).sort()).toEqual([10, 20]);
    });

    it('проверяется порядок ПОСЛЕ сортировки, а не порядок строк из базы', () => {
        // Из базы строки пришли вперемешку, но по `order` блок непрерывен.
        expect(isContiguous([q(3, 3, null), q(1, 1, 10), q(2, 2, 10)])).toBe(true);
    });

    it('при равном order порядок решает id — тот же tie-break, что у выдачи ученику', () => {
        // order одинаковый: 10-й блок займёт позиции 0 и 1 по возрастанию id.
        expect(isContiguous([q(2, 5, 10), q(1, 5, 10), q(3, 5, null)])).toBe(true);
        expect(isContiguous([q(1, 5, 10), q(2, 5, null), q(3, 5, 10)])).toBe(false);
    });

    it('вопрос без order уходит в конец и не ломает соседний блок', () => {
        expect(isContiguous([q(1, 1, 10), q(2, 2, 10), q(3, null, null)])).toBe(true);
    });

    it('одинокий вопрос блока непрерывен по определению', () => {
        expect(isContiguous([q(1, 1, 10), q(2, 2, null), q(3, 3, null)])).toBe(true);
    });

    it('вопросы без блоков не проверяются вовсе', () => {
        expect(isContiguous([q(1, 1, null), q(2, 2, null), q(3, 3, null)])).toBe(true);
        expect(isContiguous([])).toBe(true);
    });
});

describe('область инварианта — один тест (phase-53)', () => {
    it('один контекст в двух тестах нарушением не считается', () => {
        // Каждый тест проверяется отдельно: блок 7 стоит подряд и там, и там.
        const first = findContiguityViolations([
            { id: 1, order: 1, passage_id: 7 },
            { id: 2, order: 2, passage_id: 7 },
            { id: 3, order: 3, passage_id: null },
        ]);
        const second = findContiguityViolations([
            { id: 10, order: 1, passage_id: null },
            { id: 11, order: 2, passage_id: 7 },
            { id: 12, order: 3, passage_id: 7 },
        ]);
        expect(first).toEqual([]);
        expect(second).toEqual([]);
    });
});
