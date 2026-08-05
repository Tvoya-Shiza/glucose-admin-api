import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { isMediaSigningEnabled, signMediaUrl } from '../utils/media-signing';

/**
 * Подписывает ссылки на `/static/` в исходящем ответе (phase-49).
 *
 * ЗЕРКАЛО одноимённого интерцептора из glucose-api.
 *
 * ПОЧЕМУ ИМЕННО ИНТЕРЦЕПТОР, а не подпись в `toAbsoluteMediaUrl`.
 *
 * Сборка URL зовётся изнутри кэшируемых блоков — например `books.service.ts`
 * собирает ссылки на страницы внутри `getOrSet`. Подпиши мы их там, подпись
 * запеклась бы в Redis на весь TTL кэша и протухла бы посреди него: ученик
 * получил бы 410 на странице, которая «только что открывалась». Пришлось бы
 * держать в голове это правило в каждом новом сервисе.
 *
 * Интерцептор работает ПОСЛЕ чтения из кэша, поэтому в кэш физически попадает
 * только неподписанный путь, а подпись всегда свежая. Правило перестаёт быть
 * правилом, которое надо помнить, и становится свойством конвейера.
 *
 * Обход тела ответа здесь не новая цена: `CustomBigIntInterceptor` уже
 * рекурсивно обходит каждый ответ целиком.
 */
@Injectable()
export class MediaSigningInterceptor implements NestInterceptor {
    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        if (!isMediaSigningEnabled()) return next.handle();

        const contentType = context.switchToHttp().getResponse().getHeader('Content-Type');
        if (contentType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
            return next.handle();
        }

        // Одна отметка времени на весь ответ: иначе двадцать ссылок на одной
        // странице книги получат двадцать разных сроков жизни, и отлаживать
        // «почему эта картинка умерла раньше соседней» будет нечем.
        const now = Date.now();
        return next.handle().pipe(map((data) => this.sign(data, now)));
    }

    private sign(data: any, now: number, visited = new WeakSet()): any {
        if (data === null || data === undefined) return data;

        if (typeof data === 'string') {
            // Дешёвый отсев: подавляющее большинство строк в ответе — не ссылки.
            return data.includes('/static/') ? signMediaUrl(data, now) : data;
        }

        if (typeof data !== 'object') return data;

        if (visited.has(data)) return data;
        visited.add(data);

        if (Array.isArray(data)) return data.map((item) => this.sign(item, now, visited));

        // Buffer/Date/Decimal и прочие «объекты-значения» разбирать по ключам
        // нельзя — вернём как есть.
        if (Buffer.isBuffer(data) || data instanceof Date) return data;

        const result: Record<string, any> = {};
        for (const key in data) {
            if (Object.prototype.hasOwnProperty.call(data, key)) {
                result[key] = this.sign(data[key], now, visited);
            }
        }
        return result;
    }
}
