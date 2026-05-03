import { IsIn, IsString, Length } from 'class-validator';

/**
 * TranslationDto — per-locale title for Quiz / QuizCategory / QuizBadge.
 *
 * Phase 6 Plan 01 — locked contract surface (D-25).
 *
 * Reused by:
 *   - CreateQuizDto.translations[] / UpdateQuizDto.translations[] (Quizzes → QuizTranslation)
 *   - UpsertCategoryDto.translations[] (QuizCategory → QuizCategoryTranslation)
 *   - UpsertBadgeDto.translations[] (QuizBadge → QuizBadgeTranslation)
 *
 * Schema-truth notes:
 *   - QuizTranslation.title is `String @db.Text` (line 497) — large body OK.
 *     QuizCategoryTranslation.title is `String @db.VarChar(255)` (line 528) — 255 cap.
 *     QuizBadgeTranslation.title is `String @db.VarChar(255)` (line 661) — 255 cap.
 *   - To match the tightest column we cap at 255 here. Quiz titles longer than 255
 *     can be stored (Text column) but admin UI never produces them — staff write
 *     short titles only.
 *   - Locale is enforced ru|kz at the API boundary; DB column is varchar/char(255)
 *     and does NOT enforce the union (services write the literal verbatim).
 *
 * Question/answer-level translations DO NOT use this DTO — they have richer fields
 * (description, correct). See UpsertQuestionDto / UpsertAnswerDto.
 */
export type Locale = 'ru' | 'kz';

export class TranslationDto {
    @IsIn(['ru', 'kz'])
    locale!: Locale;

    @IsString()
    @Length(1, 255)
    title!: string;
}
