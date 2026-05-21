/**
 * Response shape for GET /admin-api/v1/admin/users/:id/quizzes.
 *
 * `access` enumerates Sale rows where this user owns a `quiz_id` or `quiz_badge_id`
 * grant that has not been refunded. `results` enumerates QuizResult attempts. Quiz
 * names join through `QuizTranslation` (kz first, otherwise the first available
 * locale) — badge names join through `QuizBadgeTranslation` analogously.
 */
export class UserQuizzesResponseDto {
    access!: Array<{
        sale_id: number;
        quiz_id: number | null;
        quiz_badge_id: number | null;
        quiz_name: string | null;
        kind: 'quiz' | 'quiz_badge';
        manual_added: boolean;
        access_days: number | null;
        created_at: number;
        refund_at: number | null;
    }>;
    results!: Array<{
        id: number;
        quiz_id: number;
        quiz_name: string | null;
        status: 'waiting' | 'passed' | 'failed';
        user_grade: number | null;
        created_at: number;
    }>;
}
