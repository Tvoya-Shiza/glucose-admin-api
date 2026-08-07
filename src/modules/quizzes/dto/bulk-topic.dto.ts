import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsInt, IsOptional, Min } from 'class-validator';

/**
 * Массовая простановка темы вопросам одного теста (phase-55).
 *
 * Заводится потому, что размечать 1051 существующий вопрос по одному
 * нереально, а без разметки разбор результата по темам пуст и функция
 * выглядит несделанной.
 */
export class BulkTopicDto {
    /**
     * Идентификаторы вопросов. Потолок 500 совпадает с потолком привязки к
     * текстовому блоку: разметить «весь тест разом» должно быть можно, а
     * тысяча идентификаторов в теле — уже признак ошибки на клиенте.
     */
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(500)
    @ArrayUnique()
    @Type(() => Number)
    @IsInt({ each: true })
    question_ids!: number[];

    /** null — снять тему. */
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    topic_id?: number | null;
}
