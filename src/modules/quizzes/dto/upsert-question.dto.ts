import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    ArrayMinSize,
    IsArray,
    IsIn,
    IsInt,
    IsOptional,
    IsString,
    Length,
    MaxLength,
    Min,
    ValidateNested,
} from 'class-validator';

/**
 * QZ-04 upsert-question payload (single create/update — POST or PATCH).
 *
 * Phase 6 Plan 01 — locked contract surface (D-06 / D-08 / D-11 / D-12).
 * Consumed by Plan 05 questions controller/service.
 *
 * Schema-truth notes:
 *   - QuizQuestion.grade is `Int` (line 562) — REQUIRED on schema, ≥1 enforced here.
 *   - QuizQuestion.type is QuizQuestionType: 'single'|'multiple'|'descriptive'|'identificative'.
 *   - QuizQuestion.image / .video are `String? @db.Text` — URL paths from Phase 5 upload-token.
 *   - QuizQuestion.answer_video_url is `String? @db.VarChar(255)` (line 563).
 *   - QuizQuestionTranslation.title is `String @db.Text` — large body OK; capped at 2000 here.
 *   - QuizQuestionTranslation.description is `String? @db.Text` — TIPTAP HTML (sanitized in Plan 05).
 *   - QuizQuestionTranslation.correct is `String? @db.Text` — DESCRIPTIVE-ONLY answer text.
 *
 * `correct` field semantics (D-06):
 *   - type='descriptive' → translation.correct holds the expected answer text per locale.
 *   - type='single'|'multiple'|'identificative' → service IGNORES translation.correct on save.
 *     (For these types, correctness lives on the QuizQuestionAnswer.correct boolean per row.)
 *
 * `force_confirm_token` (D-11..D-14):
 *   - Optional in this Plan's DTO surface. Plan 05's verifier checks the token ONLY when the
 *     edit is detected as DESTRUCTIVE (changing question text / changing answer correctness /
 *     deleting things). On non-destructive paths (creating a new question — no in-flight
 *     attempts can possibly conflict), the token is ignored.
 *   - Token shape: see ForceConfirmTokenClaims in force-confirm.dto.ts.
 */
export type UpsertQuestionType = 'single' | 'multiple' | 'descriptive' | 'identificative';
export type UpsertQuestionLocale = 'kz';

export class UpsertQuestionTranslationDto {
    // 'ru' accepted for backward compatibility; service filters RU out before persisting.
    @IsIn(['ru', 'kz'])
    locale!: 'ru' | 'kz';

    @IsString()
    @Length(1, 2000)
    title!: string;

    /**
     * Tiptap HTML. Sanitized server-side in Plan 05 (DOMPurify or equivalent).
     * Cap at 50000 chars defends against accidental paste-bombs.
     */
    @IsOptional()
    @IsString()
    @MaxLength(50000)
    description?: string | null;

    /**
     * Descriptive-type expected-answer text per locale. Ignored when parent
     * question.type !== 'descriptive'.
     */
    @IsOptional()
    @IsString()
    @MaxLength(5000)
    correct?: string | null;
}

export class UpsertQuestionDto {
    /** Omit on create. Required on update. */
    @IsOptional()
    @IsInt()
    @Min(1)
    id?: number;

    @IsInt()
    @Min(1)
    grade!: number;

    /**
     * Тема из справочника (phase-51). null или отсутствует — вопрос без темы:
     * так живут все 1009 существующих вопросов, и требовать тему задним числом
     * значило бы сломать редактирование каждого из них.
     */
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    topic_id?: number | null;

    /**
     * Контекст из справочника (phase-53) — стимульный текст над вопросом.
     * null или отсутствует — самостоятельный вопрос.
     *
     * Как и у темы: `null` означает «очистить», отсутствие поля — «не трогать».
     * Иначе клиент, который про контексты ещё не знает, стирал бы привязку при
     * каждом сохранении вопроса.
     */
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    passage_id?: number | null;

    @IsIn(['single', 'multiple', 'descriptive', 'identificative'])
    type!: UpsertQuestionType;

    @IsOptional()
    @IsString()
    @MaxLength(1024)
    image?: string | null;

    @IsOptional()
    @IsString()
    @MaxLength(1024)
    video?: string | null;

    @IsOptional()
    @IsString()
    @MaxLength(255)
    answer_video_url?: string | null;

    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(2)
    @ValidateNested({ each: true })
    @Type(() => UpsertQuestionTranslationDto)
    translations!: UpsertQuestionTranslationDto[];

    /**
     * Optional force-confirm JWT (verified in Plan 05 when edit is destructive).
     * See force-confirm.dto.ts for token shape and lifecycle.
     */
    @IsOptional()
    @IsString()
    @MaxLength(2048)
    force_confirm_token?: string;
}
