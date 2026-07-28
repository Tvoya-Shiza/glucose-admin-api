import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { TRAINER_THEME_PALETTES } from '@shared/trainers';

/**
 * Phase 43 — тема оформления игры (картинка-фон + палитра плиток ответов).
 *
 * Список палитр берётся из общих типов, а не из локального литерала: тот же
 * список читают селект в админке и рендер плиток в игре, и три независимые
 * копии неизбежно разъехались бы.
 */
export class UpsertTrainerThemeDto {
    @IsString()
    @MinLength(1)
    @MaxLength(255)
    title!: string;

    /** Фон игры. Пусто — тема без картинки, фон возьмётся из настроек тренажёра. */
    @IsOptional()
    @IsString()
    @MaxLength(512)
    image?: string | null;

    @IsOptional()
    @IsIn(TRAINER_THEME_PALETTES as unknown as string[])
    palette?: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    sort_order?: number;

    @IsOptional()
    @IsBoolean()
    is_active?: boolean;
}
