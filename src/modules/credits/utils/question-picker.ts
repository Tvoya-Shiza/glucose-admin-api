import type { CreditDifficulty, CreditQuestionDeficit } from '@shared/credits';

/**
 * Pure question picker for the launch wizard (contract §launches, decision 5).
 *
 * `question_count` is PER TOPIC and `template` (difficulty_template) applies per
 * topic: for every selected topic the student receives exactly template.length
 * questions whose difficulties follow the template slot-by-slot. Total questions
 * per student = topicIds.length * questionCount.
 *
 * Position numbering is 1-based and globally sequential across topics:
 *   position = topicIdx * questionCount + slotIdx + 1
 *
 * Randomness is a Fisher–Yates shuffle over each (topic, difficulty) candidate
 * pool with an INJECTABLE rng (() => number in [0, 1)) so specs can pin the
 * shuffle deterministically. No candidate is used twice within one pick.
 *
 * Pure function — no I/O, no Date, no Math.random unless the caller passes it.
 */

export type PickerRng = () => number;

/** topic_id (string) → difficulty → candidate question ids (opaque strings). */
export type PickerCandidates = Record<string, Partial<Record<CreditDifficulty, string[]>>>;

export interface PickedSessionQuestion {
    question_id: string;
    topic_id: string;
    position: number;
    difficulty: CreditDifficulty;
}

export type QuestionPickResult =
    | { ok: true; questions: PickedSessionQuestion[] }
    | { ok: false; deficits: CreditQuestionDeficit[] };

export interface PickSessionQuestionsInput {
    /** Selected topic ids, deduplicated, in wizard order. */
    topicIds: string[];
    /** Questions per topic; MUST equal template.length. */
    questionCount: number;
    /** Difficulty template applied per topic, slot-by-slot. */
    template: CreditDifficulty[];
    candidates: PickerCandidates;
    rng: PickerRng;
}

const DIFFICULTIES: CreditDifficulty[] = ['A', 'B', 'C'];

/** Fisher–Yates over a copy; the input array is never mutated. */
function shuffle<T>(items: readonly T[], rng: PickerRng): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

/** How many questions of each difficulty the template demands (per topic). */
export function templateRequirements(template: CreditDifficulty[]): Record<CreditDifficulty, number> {
    const req: Record<CreditDifficulty, number> = { A: 0, B: 0, C: 0 };
    for (const d of template) req[d] += 1;
    return req;
}

export function pickSessionQuestions(input: PickSessionQuestionsInput): QuestionPickResult {
    const { topicIds, questionCount, template, candidates, rng } = input;

    if (template.length !== questionCount) {
        throw new Error(`difficulty_template length (${template.length}) must equal question_count (${questionCount})`);
    }

    const required = templateRequirements(template);

    // ---- Deficit pass: report EVERY shortage in one response (422 credits.question_deficit). ----
    const deficits: CreditQuestionDeficit[] = [];
    for (const topicId of topicIds) {
        for (const d of DIFFICULTIES) {
            if (required[d] === 0) continue;
            const available = candidates[topicId]?.[d]?.length ?? 0;
            if (available < required[d]) {
                deficits.push({ topic_id: topicId, difficulty: d, required: required[d], available });
            }
        }
    }
    if (deficits.length > 0) {
        return { ok: false, deficits };
    }

    // ---- Pick pass: shuffle each (topic, difficulty) pool once, consume in template slot order. ----
    const questions: PickedSessionQuestion[] = [];
    for (let topicIdx = 0; topicIdx < topicIds.length; topicIdx++) {
        const topicId = topicIds[topicIdx];
        const shuffled: Partial<Record<CreditDifficulty, string[]>> = {};
        const cursor: Record<CreditDifficulty, number> = { A: 0, B: 0, C: 0 };
        for (const d of DIFFICULTIES) {
            if (required[d] > 0) shuffled[d] = shuffle(candidates[topicId]?.[d] ?? [], rng);
        }
        for (let slotIdx = 0; slotIdx < template.length; slotIdx++) {
            const d = template[slotIdx];
            const pool = shuffled[d] ?? [];
            const questionId = pool[cursor[d]];
            cursor[d] += 1;
            questions.push({
                question_id: questionId,
                topic_id: topicId,
                position: topicIdx * questionCount + slotIdx + 1,
                difficulty: d,
            });
        }
    }

    return { ok: true, questions };
}
