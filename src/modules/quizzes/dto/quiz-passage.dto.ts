import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/**
 * Текстовый блок теста (phase-52) — стимульный текст формата ҰБТ, общий для
 * нескольких вопросов.
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

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    position?: number;
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

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    position?: number;
}

export interface QuizPassageDto {
    id: number;
    quiz_id: number;
    position: number;
    title: string | null;
    body: string;
    image: string | null;
    /** Сколько вопросов привязано — виден вес блока перед удалением. */
    question_count: number;
}
