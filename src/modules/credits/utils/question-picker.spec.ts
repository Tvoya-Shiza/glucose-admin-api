/// <reference types="jest" />
/**
 * question-picker specs (contract §launches, decision 5).
 *
 * Covers:
 *   - template expansion per topic (topics × question_count total, template per topic)
 *   - deficit detection with exact { topic_id, difficulty, required, available }
 *   - randomness varies with the injected rng (and is deterministic for equal rngs)
 *   - position numbering: topicIdx * question_count + slotIdx + 1
 *   - template length validation (template.length !== question_count → throw)
 */
import type { CreditDifficulty } from '@shared/credits';
import { pickSessionQuestions, templateRequirements, type PickerCandidates, type PickerRng } from './question-picker';

/** Deterministic LCG rng so shuffles are reproducible per seed. */
function seededRng(seed: number): PickerRng {
    let state = seed >>> 0;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

function candidates(spec: Record<string, Partial<Record<CreditDifficulty, number>>>): PickerCandidates {
    const out: PickerCandidates = {};
    for (const [topicId, byDifficulty] of Object.entries(spec)) {
        out[topicId] = {};
        for (const [d, count] of Object.entries(byDifficulty)) {
            out[topicId][d as CreditDifficulty] = Array.from({ length: count as number }, (_, i) => `${topicId}-${d}-${i + 1}`);
        }
    }
    return out;
}

describe('templateRequirements', () => {
    it('counts each difficulty in the template', () => {
        expect(templateRequirements(['A', 'A', 'B', 'B', 'C'])).toEqual({ A: 2, B: 2, C: 1 });
        expect(templateRequirements(['C'])).toEqual({ A: 0, B: 0, C: 1 });
    });
});

describe('pickSessionQuestions', () => {
    const template: CreditDifficulty[] = ['A', 'A', 'B', 'B', 'C'];

    it('expands the template per topic: topics × question_count questions, difficulties follow the template', () => {
        const result = pickSessionQuestions({
            topicIds: ['10', '20'],
            questionCount: 5,
            template,
            candidates: candidates({ '10': { A: 3, B: 2, C: 1 }, '20': { A: 2, B: 4, C: 2 } }),
            rng: seededRng(42),
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.questions).toHaveLength(10);

        // Per topic: exactly question_count questions, template difficulties slot-by-slot.
        for (const [topicIdx, topicId] of ['10', '20'].entries()) {
            const own = result.questions.filter((q) => q.topic_id === topicId);
            expect(own).toHaveLength(5);
            expect(own.map((q) => q.difficulty)).toEqual(template);
            // Every picked id belongs to that topic's pool.
            for (const q of own) {
                expect(q.question_id.startsWith(`${topicId}-${q.difficulty}-`)).toBe(true);
            }
            expect(own.map((q) => q.position)).toEqual(template.map((_, slotIdx) => topicIdx * 5 + slotIdx + 1));
        }

        // No candidate is used twice.
        const ids = result.questions.map((q) => q.question_id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('numbers positions globally: position = topicIdx * question_count + slotIdx + 1', () => {
        const result = pickSessionQuestions({
            topicIds: ['1', '2', '3'],
            questionCount: 2,
            template: ['A', 'C'],
            candidates: candidates({ '1': { A: 2, C: 2 }, '2': { A: 2, C: 2 }, '3': { A: 2, C: 2 } }),
            rng: seededRng(7),
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.questions.map((q) => q.position)).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it('reports every deficit with exact { topic_id, difficulty, required, available }', () => {
        const result = pickSessionQuestions({
            topicIds: ['10', '20'],
            questionCount: 5,
            template, // requires A:2 B:2 C:1 per topic
            candidates: candidates({ '10': { A: 1, B: 2, C: 0 }, '20': { A: 2, B: 2, C: 1 } }),
            rng: seededRng(1),
        });

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.deficits).toEqual([
            { topic_id: '10', difficulty: 'A', required: 2, available: 1 },
            { topic_id: '10', difficulty: 'C', required: 1, available: 0 },
        ]);
    });

    it('treats a topic missing from candidates as available: 0', () => {
        const result = pickSessionQuestions({
            topicIds: ['99'],
            questionCount: 1,
            template: ['B'],
            candidates: {},
            rng: seededRng(1),
        });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.deficits).toEqual([{ topic_id: '99', difficulty: 'B', required: 1, available: 0 }]);
    });

    it('varies picks with the rng and is deterministic for identical rng sequences', () => {
        const input = {
            topicIds: ['10'],
            questionCount: 3,
            template: ['A', 'A', 'A'] as CreditDifficulty[],
            candidates: candidates({ '10': { A: 30 } }),
        };

        const a1 = pickSessionQuestions({ ...input, rng: seededRng(1) });
        const a2 = pickSessionQuestions({ ...input, rng: seededRng(1) });
        const b = pickSessionQuestions({ ...input, rng: seededRng(999) });

        expect(a1.ok && a2.ok && b.ok).toBe(true);
        if (!a1.ok || !a2.ok || !b.ok) return;
        // Same rng sequence → same picks (Fisher–Yates is deterministic given the rng).
        expect(a1.questions).toEqual(a2.questions);
        // Different rng sequence → different picks (30 candidates make a collision negligible).
        expect(b.questions.map((q) => q.question_id)).not.toEqual(a1.questions.map((q) => q.question_id));
    });

    it('throws when template.length !== question_count', () => {
        expect(() =>
            pickSessionQuestions({
                topicIds: ['10'],
                questionCount: 5,
                template: ['A', 'B'],
                candidates: candidates({ '10': { A: 5, B: 5 } }),
                rng: seededRng(1),
            }),
        ).toThrow(/difficulty_template length \(2\) must equal question_count \(5\)/);
    });
});
