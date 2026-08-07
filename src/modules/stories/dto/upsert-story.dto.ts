import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    ArrayMinSize,
    IsArray,
    IsBoolean,
    IsIn,
    IsInt,
    IsOptional,
    IsString,
    Max,
    MaxLength,
    Min,
    ValidateNested,
} from 'class-validator';

/**
 * STY-01 — upsert-story DTOs (Phase 7 Plan 02).
 *
 * `UpsertStoryDto` is used both for POST (create — required fields enforced via
 * @IsNotEmpty-style validators) and PATCH (update — all fields permitted as
 * optional via the controller mapping `Partial<UpsertStoryDto>` semantically).
 * Service code differentiates create vs update by call site, not by DTO shape.
 *
 * Schema-truth (Plan 01 lock):
 *   - Story.status: BlogStatus enum ('pending' | 'publish'); default 'pending'.
 *   - Story.image / icon / video are all `String?` (nullable) — admit `null` to clear.
 *   - StoryTranslation has NO @@unique([story_id, locale]) — service uses
 *     find-then-update inside $transaction.
 *   - StoryTranslation.description is `Text` (NOT NULL); .content is `LongText` (NOT NULL).
 *
 * Translations: 1..2 entries, locale narrowed to 'ru' | 'kz' at the API boundary.
 */
export type StoryLocale = 'kz';
export type StoryStatusInput = 'pending' | 'publish';

export class StoryTranslationDto {
    // 'ru' accepted for backward compatibility; service filters RU out before persisting.
    @IsIn(['ru', 'kz'])
    locale!: 'ru' | 'kz';

    @IsString()
    @MaxLength(255)
    title!: string;

    @IsString()
    @MaxLength(2000)
    description!: string;

    @IsString()
    @MaxLength(50000)
    content!: string;
}

export class UpsertStoryDto {
    /** kebab-style slug; admin-api re-validates on the service path. */
    @IsOptional()
    @IsString()
    @MaxLength(255)
    slug?: string;

    /** image url; null clears (the column is nullable). */
    @IsOptional()
    @IsString()
    @MaxLength(255)
    image?: string | null;

    @IsOptional()
    @IsString()
    @MaxLength(255)
    icon?: string | null;

    @IsOptional()
    @IsString()
    @MaxLength(255)
    video?: string | null;

    @IsOptional()
    @IsIn(['pending', 'publish'])
    status?: StoryStatusInput;

    /**
     * Устаревшее поле: убрано из формы админки, сервером не записывается.
     *
     * В DTO оставлено НАМЕРЕННО. Глобальный ValidationPipe стоит с
     * `forbidNonWhitelisted: true` — незнакомое поле в теле даёт 400, а не
     * молчаливый пропуск. В окне выкатки, когда новый admin-api уже поднят, а
     * admin-client ещё старый, форма продолжала бы слать `enable_comment` и
     * методист не смог бы сохранить ни один сторис.
     *
     * Принимаем и игнорируем. Удалить можно будет, когда старых клиентов
     * заведомо не останется.
     */
    @IsOptional()
    @IsBoolean()
    enable_comment?: boolean;

    @IsOptional()
    @IsString()
    @MaxLength(255)
    link_type?: string | null;

    @IsOptional()
    @IsString()
    @MaxLength(255)
    page_type?: string | null;

    @IsOptional()
    @IsString()
    @MaxLength(255)
    link?: string | null;

    /**
     * Показывать ли кнопку перехода в сторисе (phase-54). Куда ведёт — `link`.
     * Проверку «включено, но ссылка пуста» делает форма админки: на сервере
     * ссылку могли задать раньше и отдельным сохранением.
     */
    @IsOptional()
    @IsBoolean()
    show_more_button?: boolean;

    /**
     * Длительность показа видео в секундах (phase-54). null — не задано,
     * мобилка подставит своё умолчание. Ноль запрещён: он означал бы «свернуть
     * мгновенно», и это почти наверняка опечатка, а не намерение.
     */
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(86400)
    video_duration?: number | null;

    @IsOptional()
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(2)
    @ValidateNested({ each: true })
    @Type(() => StoryTranslationDto)
    translations?: StoryTranslationDto[];
}
