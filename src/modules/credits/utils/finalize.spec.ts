/// <reference types="jest" />
/**
 * finalize math specs (contract decisions 12 + 15).
 *
 * Covers:
 *   - only mark='correct' snapshots are summed
 *   - skipped / pending / incorrect contribute 0
 *   - boundary: score === pass_threshold → passed
 *   - percent rounding (Math.round; 0 when max_score is 0)
 */
import { computeFinalResult, computePercent } from './finalize';

describe('computeFinalResult', () => {
    it('sums only correct marks', () => {
        const out = computeFinalResult(
            [
                { score: 2, mark: 'correct' },
                { score: 3, mark: 'incorrect' },
                { score: 5, mark: 'correct' },
            ],
            5,
        );
        expect(out.score).toBe(7);
        expect(out.passed).toBe(true);
    });

    it('counts skipped and pending (untouched) questions as 0 points', () => {
        const out = computeFinalResult(
            [
                { score: 4, mark: 'skipped' },
                { score: 4, mark: 'pending' },
                { score: 1, mark: 'correct' },
            ],
            2,
        );
        expect(out.score).toBe(1);
        expect(out.passed).toBe(false);
    });

    it('passes on the exact boundary score === pass_threshold', () => {
        const out = computeFinalResult(
            [
                { score: 3, mark: 'correct' },
                { score: 2, mark: 'correct' },
            ],
            5,
        );
        expect(out.score).toBe(5);
        expect(out.passed).toBe(true);
    });

    it('fails one point below the threshold', () => {
        const out = computeFinalResult([{ score: 4, mark: 'correct' }], 5);
        expect(out.passed).toBe(false);
    });

    it('returns score 0 / not passed for an empty question list with a positive threshold', () => {
        expect(computeFinalResult([], 1)).toEqual({ score: 0, passed: false });
    });

    it('threshold 0 always passes (score >= 0)', () => {
        expect(computeFinalResult([{ score: 2, mark: 'incorrect' }], 0)).toEqual({ score: 0, passed: true });
    });
});

describe('computePercent', () => {
    it('rounds half up per Math.round', () => {
        expect(computePercent(1, 3)).toBe(33); // 33.33…
        expect(computePercent(2, 3)).toBe(67); // 66.66…
        expect(computePercent(1, 2)).toBe(50);
        expect(computePercent(5, 8)).toBe(63); // 62.5 → 63
    });

    it('returns 0 when max_score is 0 (no division by zero)', () => {
        expect(computePercent(0, 0)).toBe(0);
        expect(computePercent(5, 0)).toBe(0);
    });

    it('full score is 100', () => {
        expect(computePercent(7, 7)).toBe(100);
    });
});
