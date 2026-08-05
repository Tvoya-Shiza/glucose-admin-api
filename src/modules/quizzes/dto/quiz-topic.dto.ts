import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/**
 * Справочник тем тестов (phase-51).
 *
 * Заказчик: «рядом с Көшіру сделать справочник по темам — чтобы у студента в
 * конце был разбор по темам».
 *
 * Скопировано с DTO тем зачётов (`create-credit-topic.dto.ts` и соседи) с одним
 * отличием: `parent_id` здесь ЧИСЛО, а не decimal-строка. У зачётов id — BigInt
 * и на проводе он строкой; вопросы тестов живут в int-мире, и заводить третий
 * формат идентификатора на фронте незачем.
 */

export type QuizTopicStatus = 'active' | 'archived';

export class CreateQuizTopicDto {
    /** null или отсутствует — тема верхнего уровня. */
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    parent_id?: number | null;

    @IsString()
    @IsNotEmpty()
    @MaxLength(255)
    name!: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    position?: number;
}

export class UpdateQuizTopicDto {
    @IsOptional()
    @IsString()
    @IsNotEmpty()
    @MaxLength(255)
    name?: string;

    /** `parent_id: null` поднимает тему в корень; ненулевое — проверка на цикл. */
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    parent_id?: number | null;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    position?: number;

    @IsOptional()
    @IsIn(['active', 'archived'])
    status?: QuizTopicStatus;
}

export class ListQuizTopicsDto {
    /** `?include_archived=true` — вместе с архивными. По умолчанию только активные. */
    @IsOptional()
    @Transform(({ value }) => value === true || value === 'true' || value === '1')
    @IsBoolean()
    include_archived?: boolean;
}

/** Плоский узел дерева: клиент собирает иерархию сам (как у зачётов). */
export interface QuizTopicNode {
    id: number;
    parent_id: number | null;
    name: string;
    position: number;
    status: QuizTopicStatus;
    /** Сколько вопросов помечено этой темой — виден вес темы перед удалением. */
    question_count: number;
    child_count: number;
}
