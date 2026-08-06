import { createHash } from 'crypto';

/**
 * Подпись ссылок на медиа (phase-49).
 *
 * ЗЕРКАЛО `glucose-api/src/common/utils/media-signing.ts`. Формула подписи
 * должна совпадать у обоих приложений и у nginx — правки только вместе.
 *
 * Сейчас страницу учебника или видео урока можно скачать прямой ссылкой, вообще
 * не заходя в систему: nginx раздаёт `/static/` из тома напрямую, минуя
 * приложение. 44 865 страниц книг лежат там же.
 *
 * Схема — штатный `secure_link` nginx (образ уже собран с
 * `--with-http_secure_link_module`, пересборка не нужна):
 *
 *     secure_link      $arg_md5,$arg_expires;
 *     secure_link_md5  "$secure_link_expires$uri$MEDIA_SIGNING_SECRET";
 *
 * nginx считает тот же md5 и сравнивает: не совпало — 403, срок истёк — 410.
 *
 * Что сознательно НЕ делаем:
 *
 *   - Не привязываем подпись к IP. У мобильных операторов он меняется посреди
 *     сессии, и ученик получал бы 403 на середине книги.
 *   - Не считаем это защитой от скриншотов. Скриншот делает операционная
 *     система, страница о нём не узнаёт; подпись закрывает другую дыру —
 *     скачивание файла тем, кто в систему не входил.
 */

/** Ссылка живёт ровно столько, сколько нужно её потребителю. */
export const MEDIA_TTL_SECONDS = {
    /**
     * Картинки: страница книги, обложка, аватар, картинка вопроса.
     *
     * Шесть часов, а не пятнадцать минут. Пятнадцати хватало «открыть и
     * пролистать», но ҰБТ байқау идёт час, сессия попытки висит в кэше клиента
     * бессрочно, и новых подписанных ссылок взять неоткуда — картинки начинали
     * отдавать 410 прямо посреди экзамена.
     *
     * Безопасность от этого почти не страдает: чтобы получить ссылку, надо
     * сперва войти в систему, а срок — вторая линия, а не первая.
     */
    image: 6 * 60 * 60,
    /**
     * Видео: плеер докачивает файл range-запросами весь сеанс просмотра, и
     * подпись должна пережить паузы, перемотку и длинный урок целиком.
     */
    video: 6 * 60 * 60,
} as const;

export type MediaKind = keyof typeof MEDIA_TTL_SECONDS;

const VIDEO_EXT_RE = /\.(mp4|m4v|mov|webm|mkv|m3u8|ts)(\?|$)/i;

/** Тип файла по расширению — от него зависит только срок жизни ссылки. */
export function mediaKindFromPath(pathname: string): MediaKind {
    return VIDEO_EXT_RE.test(pathname) ? 'video' : 'image';
}

function secret(): string | null {
    const value = process.env.MEDIA_SIGNING_SECRET;
    return value && value.trim().length > 0 ? value : null;
}

/**
 * Подпись включена? Без секрета подписывать нечем — тогда ссылки уходят как
 * раньше. Это сделано намеренно: локальная разработка и прод с ещё не
 * заполненным `.env` продолжают работать, а не отдают битые ссылки.
 */
export function isMediaSigningEnabled(): boolean {
    return secret() !== null;
}

/**
 * base64url от СЫРЫХ байт md5 — ровно тот формат, который ждёт nginx
 * (`secure_link` требует base64url без выравнивающих '='). Hex здесь не
 * подойдёт: nginx сравнивает именно base64url-представление.
 */
function signature(expires: number, uri: string, key: string): string {
    return createHash('md5')
        .update(`${expires}${uri}${key}`)
        .digest('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

/**
 * Дописывает подпись к абсолютному URL медиа.
 *
 * Возвращает вход без изменений, если подписывать нечем или незачем: другой
 * хост, не `/static/`, уже подписано. Функция обязана быть безвредной для
 * произвольной строки — её зовёт интерцептор для всего, что похоже на ссылку.
 */
export function signMediaUrl(url: string, now = Date.now()): string {
    const key = secret();
    if (!key) return url;
    if (url.includes('md5=')) return url;

    // Строка с разметкой — это НЕ ссылка, а текст со ссылками внутри. Ловим её
    // до `new URL`, иначе сработает коварный случай: HTML, начинающийся со
    // слэша, распарсится как относительный путь, и подпись допишется в
    // середину текста. Такие строки разбирает `signMediaUrlsInHtml`.
    if (looksLikeHtml(url)) return url;

    // Относительный путь подписываем тоже: админка хранит file_url как
    // `/static/courses/<ulid>.<ext>` и делает его абсолютным уже в браузере.
    // nginx считает md5 от $uri, то есть от пути, — форма ссылки ему безразлична.
    // База здесь фиктивная и в результат не попадает.
    const isRelative = url.startsWith('/');
    let parsed: URL;
    try {
        parsed = new URL(url, isRelative ? 'https://media.invalid' : undefined);
    } catch {
        return url;
    }
    if (!parsed.pathname.startsWith('/static/')) return url;

    const ttl = MEDIA_TTL_SECONDS[mediaKindFromPath(parsed.pathname)];
    const expires = Math.floor(now / 1000) + ttl;
    // Подписываем ИМЕННО pathname: nginx считает md5 от $uri, в который
    // query-строка не входит. Кодирование тоже должно совпадать — берём
    // parsed.pathname, а не исходную подстроку, чтобы URL-класс нормализовал
    // её так же, как это сделает браузер перед отправкой.
    const md5 = signature(expires, parsed.pathname, key);
    parsed.searchParams.set('md5', md5);
    parsed.searchParams.set('expires', String(expires));
    return isRelative ? `${parsed.pathname}${parsed.search}` : parsed.toString();
}

/** Строка похожа на разметку, а не на ссылку: есть тег вида `<x` или `</x`. */
export function looksLikeHtml(value: string): boolean {
    return /<\/?[a-z][\s\S]*>/i.test(value);
}

/**
 * Абсолютный адрес нашего API — то, к чему достраиваются относительные ссылки
 * внутри HTML.
 *
 * Нужен именно он, а не относительный путь: HTML уходит студенту на
 * `app.glucoseonline.kz`, где `/static/` не обслуживается вовсе, и браузер
 * получает 404. В админке тот же путь случайно работал, поэтому методист видел
 * картинку, а ученик — нет.
 */
function apiBase(): string {
    const value = process.env.API_URL || process.env.PUBLIC_API_URL || '';
    return value.replace(/\/+$/, '');
}

/**
 * Подписывает ссылки на `/static/` ВНУТРИ HTML-строки.
 *
 * Зачем отдельная функция: Tiptap кладёт картинки прямо в тело описания
 * (`<img src="/static/courses/X.png">`), и подписать такую строку целиком
 * нельзя — она не URL. Раньше интерцептор честно возвращал её нетронутой, и
 * все картинки в описаниях вопросов отдавали 403.
 *
 * Разбираем регулярным выражением, а не парсером: нас интересуют ровно
 * `src` и `href`, значение всегда в кавычках (их ставит и Tiptap, и
 * санитайзер), а тащить парсер HTML в горячий путь сериализации ответа
 * несоразмерно.
 */
export function signMediaUrlsInHtml(html: string, now = Date.now()): string {
    if (!secret()) return html;
    if (!html.includes('/static/')) return html;

    return html.replace(/\b(src|href)=(["'])([^"']*\/static\/[^"']*)\2/gi, (match, attr, quote, raw) => {
        if (raw.includes('md5=')) return match;
        // Относительную ссылку достраиваем до API-хоста: иначе у студента она
        // уйдёт на домен приложения и вернёт 404 ещё до всякой подписи.
        const absolute = raw.startsWith('/') && apiBase() ? `${apiBase()}${raw}` : raw;
        return `${attr}=${quote}${signMediaUrl(absolute, now)}${quote}`;
    });
}
