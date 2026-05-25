/**
 * Восстанавливает кириллицу, побайтово закодированную как latin-1 → UTF-8.
 *
 * Исторический контекст: в legacy education (Laravel) и в части потоков
 * glucose-api имена загружаемых файлов писались на диск/в БД без перекодирования
 * из исходного UTF-8 в Latin-1 — в итоге строка вида "Почему именно США.pdf"
 * сохранилась как "ÐÐ¾ÑÐµÐ¼Ñ Ð¸Ð¼ÐµÐ½Ð½Ð¾ Ð¡Ð¨Ð.pdf". Это та же
 * последовательность байт, просто проинтерпретированная как cp1252/latin-1,
 * после чего «вторая» UTF-8 кодировка превратила её в наблюдаемый мусор.
 *
 * Чинить безопасно, только если строка содержит характерный mojibake-паттерн
 * (ведущий байт 0xC0-0xDF + continuation 0x80-0xBF). Иначе функция возвращает
 * вход без изменений: для уже корректной кириллицы `Buffer.from(s, 'latin1')`
 * дал бы информационную потерю.
 */

// 0xC0-0xDF (как latin-1 char) — ведущий байт UTF-8 для двухбайтового символа.
// 0x80-0xBF — continuation. На валидной кириллице (символы выше U+0400) такая
// пара не встречается, поэтому это надёжный маркер mojibake.
const MOJIBAKE_PATTERN = /[À-ß][-¿]/;
const CYRILLIC_PATTERN = /[Ѐ-ӿ]/;

export function normalizeMojibakeUtf8(input: string | null | undefined): string | null {
    if (input == null) return null;
    const s = String(input);
    if (s.length === 0) return s;

    if (!MOJIBAKE_PATTERN.test(s)) return s;

    try {
        const fixed = Buffer.from(s, 'latin1').toString('utf8');
        if (CYRILLIC_PATTERN.test(fixed)) return fixed;
    } catch {
        // ignore
    }
    return s;
}
