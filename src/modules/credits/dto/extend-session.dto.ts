import { IsInt, Max, Min } from 'class-validator';
import { CREDIT_EXTEND_MAX_SEC, CREDIT_EXTEND_MIN_SEC } from '@shared/credits';

/**
 * Продление времени сессии зачёта (phase-50).
 *
 * Только положительная дельта. Сокращать время нельзя намеренно: у ученика на
 * экране идёт таймер, и рывок назад читается как поломка. Если куратору нужно
 * закончить раньше — для этого есть «Завершить».
 *
 * Верхняя граница — час за раз. Это не запрет добавить больше, а защита от
 * опечатки: `3600` вместо `360` при вводе в секундах даёт разницу в десять раз,
 * и заметить её по таймеру ученика куратор уже не сможет.
 */
export class ExtendSessionDto {
    @IsInt()
    @Min(CREDIT_EXTEND_MIN_SEC)
    @Max(CREDIT_EXTEND_MAX_SEC)
    seconds!: number;
}
