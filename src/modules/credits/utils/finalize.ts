import type { CreditQuestionMark } from '@shared/credits';

/**
 * Pure finalize math (contract decisions 12 + 15).
 *
 *   score  = Σ score of questions with mark === 'correct'
 *            (incorrect / skipped / pending contribute 0 points)
 *   passed = score >= pass_threshold   (threshold is ABSOLUTE POINTS, resolved at launch)
 *   percent = max_score > 0 ? Math.round(score * 100 / max_score) : 0
 *
 * pass_threshold was resolved to absolute points at generation (decision 7), so
 * finalize never re-reads launch settings. Boundary: score === threshold → passed.
 */

export interface FinalizeQuestionInput {
    score: number;
    mark: CreditQuestionMark;
}

export interface FinalizeOutcome {
    score: number;
    passed: boolean;
}

export function computeFinalResult(questions: FinalizeQuestionInput[], passThreshold: number): FinalizeOutcome {
    let score = 0;
    for (const q of questions) {
        if (q.mark === 'correct') score += q.score;
    }
    return { score, passed: score >= passThreshold };
}

/** Percent for text ranges / result payloads (decision 15). */
export function computePercent(score: number, maxScore: number): number {
    return maxScore > 0 ? Math.round((score * 100) / maxScore) : 0;
}
