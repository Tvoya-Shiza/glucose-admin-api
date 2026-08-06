import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/**
 * Контекст — стимульный текст формата ҰБТ, общий для нескольких вопросов
 * (phase-52; в phase-53 стал общим справочником, а не частью теста).
 */

/** Потолок текста. Тот же, что у `description` вопроса — это тот же Tiptap HTML. */
export const PASSAGE_BODY_MAX = 50_000;

export class CreateQuizPassageDto {
    @IsOptional()
    @IsString()
    @MaxLength(255)
    title?: string | null;

    @IsString()
    @IsNotEmpty()
    @MaxLength(PASSAGE_BODY_MAX)
    body!: string;

    @IsOptional()
    @IsString()
    image?: string | null;
}

export class UpdateQuizPassageDto {
    @IsOptional()
    @IsString()
    @MaxLength(255)
    title?: string | null;

    @IsOptional()
    @IsString()
    @IsNotEmpty()
    @MaxLength(PASSAGE_BODY_MAX)
    body?: string;

    @IsOptional()
    @IsString()
    image?: string | null;
}

/** Запрос списка справочника: поиск по названию + страница. */
export class ListQuizPassagesDto {
    @IsOptional()
    @IsString()
    @MaxLength(255)
    q?: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    per_page?: number;
}

export interface QuizPassageDto {
    id: number;
    /** Название — только для админки: заказчик просил его ради поиска. */
    title: string | null;
    body: string;
    image: string | null;
    /** Сколько вопросов привязано — виден вес блока перед удалением. */
    question_count: number;
    /** В скольких тестах блок используется. */
    quiz_count: number;
}
