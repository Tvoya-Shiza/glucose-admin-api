import { IsIn } from 'class-validator';

/**
 * Body for POST /admin-api/v1/admin/credit-sessions/:id/questions/:position/mark.
 * `pending` is NOT settable — it is the untouched default; marks stay mutable until finalize (decision 11).
 */
export class MarkQuestionDto {
    @IsIn(['correct', 'incorrect', 'skipped'])
    mark!: 'correct' | 'incorrect' | 'skipped';
}
