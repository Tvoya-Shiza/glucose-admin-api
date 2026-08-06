/// <reference types="jest" />
/**
 * Подпись ссылок на медиа (phase-49).
 *
 * Главное, что здесь проверяется, — совпадение формата с тем, что считает
 * nginx: `secure_link_md5 "$secure_link_expires$uri$SECRET"` и base64url без
 * выравнивания. Ошибись в порядке слагаемых или в кодировании — и все ссылки
 * начнут отдавать 403, причём одинаково для всех, так что заметят это сразу,
 * но чинить будут вслепую.
 */

import { createHash } from 'crypto';
import {
    MEDIA_TTL_SECONDS,
    isMediaSigningEnabled,
    looksLikeHtml,
    mediaKindFromPath,
    signMediaUrl,
    signMediaUrlsInHtml,
} from './media-signing';

const SECRET = 'test-secret';
const NOW = 1_700_000_000_000; // фиксируем время: подпись зависит от него

/** Ровно то, что делает nginx: md5 от expires+uri+secret в base64url. */
function nginxWouldCompute(expires: number, uri: string, secret: string): string {
    return createHash('md5')
        .update(`${expires}${uri}${secret}`)
        .digest('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

describe('media signing', () => {
    const original = process.env.MEDIA_SIGNING_SECRET;

    beforeEach(() => {
        process.env.MEDIA_SIGNING_SECRET = SECRET;
    });

    afterAll(() => {
        if (original === undefined) delete process.env.MEDIA_SIGNING_SECRET;
        else process.env.MEDIA_SIGNING_SECRET = original;
    });

    it('считает ту же подпись, что и nginx', () => {
        const url = signMediaUrl('https://api.example.kz/static/courses/page.webp', NOW);
        const parsed = new URL(url);
        const expires = Number(parsed.searchParams.get('expires'));

        expect(expires).toBe(Math.floor(NOW / 1000) + MEDIA_TTL_SECONDS.image);
        expect(parsed.searchParams.get('md5')).toBe(
            nginxWouldCompute(expires, '/static/courses/page.webp', SECRET),
        );
    });

    it('подпись считается от пути без query — nginx подставляет в $uri именно его', () => {
        const withQuery = signMediaUrl('https://api.example.kz/static/a/b.webp?v=3', NOW);
        const parsed = new URL(withQuery);
        const expires = Number(parsed.searchParams.get('expires'));
        expect(parsed.searchParams.get('md5')).toBe(nginxWouldCompute(expires, '/static/a/b.webp', SECRET));
        // Исходный параметр не потерян.
        expect(parsed.searchParams.get('v')).toBe('3');
    });

    it('base64url без «=»: nginx не принимает выравнивание', () => {
        const url = signMediaUrl('https://api.example.kz/static/x.webp', NOW);
        const md5 = new URL(url).searchParams.get('md5') ?? '';
        expect(md5).not.toContain('=');
        expect(md5).not.toContain('+');
        expect(md5).not.toContain('/');
    });

    it('видео живёт дольше картинки — плеер докачивает файл весь сеанс', () => {
        const image = new URL(signMediaUrl('https://api.example.kz/static/a.webp', NOW));
        const video = new URL(signMediaUrl('https://api.example.kz/static/a.mp4', NOW));
        const imageExp = Number(image.searchParams.get('expires'));
        const videoExp = Number(video.searchParams.get('expires'));
        expect(videoExp - imageExp).toBe(MEDIA_TTL_SECONDS.video - MEDIA_TTL_SECONDS.image);
    });

    it('распознаёт видео по расширению, в том числе с query', () => {
        expect(mediaKindFromPath('/static/a.mp4')).toBe('video');
        expect(mediaKindFromPath('/static/a.MOV')).toBe('video');
        expect(mediaKindFromPath('/static/hls/index.m3u8')).toBe('video');
        expect(mediaKindFromPath('/static/a.webp')).toBe('image');
        expect(mediaKindFromPath('/static/mp4-lesson/cover.jpg')).toBe('image');
    });

    it('не трогает чужие пути и чужие ссылки', () => {
        expect(signMediaUrl('https://api.example.kz/v1/quizzes', NOW)).toBe('https://api.example.kz/v1/quizzes');
        expect(signMediaUrl('https://youtube.com/watch?v=1', NOW)).toBe('https://youtube.com/watch?v=1');
    });

    it('не подписывает дважды', () => {
        const once = signMediaUrl('https://api.example.kz/static/a.webp', NOW);
        expect(signMediaUrl(once, NOW + 60_000)).toBe(once);
    });

    it('подписывает и относительный путь — админка отдаёт file_url без хоста', () => {
        const signed = signMediaUrl('/static/courses/abc.webp', NOW);
        expect(signed.startsWith('/static/courses/abc.webp?')).toBe(true);
        const params = new URLSearchParams(signed.split('?')[1]);
        const expires = Number(params.get('expires'));
        expect(params.get('md5')).toBe(nginxWouldCompute(expires, '/static/courses/abc.webp', SECRET));
        // Фиктивная база подписи не должна протечь в результат.
        expect(signed).not.toContain('media.invalid');
    });

    it('не ломается на произвольной строке — интерцептор зовёт его на всём подряд', () => {
        expect(signMediaUrl('просто текст', NOW)).toBe('просто текст');
        expect(signMediaUrl('', NOW)).toBe('');
        expect(signMediaUrl('/v1/quizzes', NOW)).toBe('/v1/quizzes');
    });

    it('HTML-строку целиком не трогает — это текст, а не ссылка', () => {
        // Раньше сюда приходил весь HTML описания вопроса, `new URL` бросал,
        // и строка возвращалась неподписанной. Теперь отсекаем явно.
        const html = '<p>текст</p><img src="/static/courses/a.png">';
        expect(signMediaUrl(html, NOW)).toBe(html);
    });

    it('HTML, начинающийся со слэша, не получает подпись в середину текста', () => {
        // Коварный случай: строка выглядит относительным путём, парсится без
        // ошибки, и подпись дописалась бы посреди разметки.
        const html = '/static/x <p>подпись сюда попасть не должна</p>';
        expect(signMediaUrl(html, NOW)).toBe(html);
    });

    it('без секрета отдаёт ссылку как есть: разработка и незаполненный .env не должны падать', () => {
        delete process.env.MEDIA_SIGNING_SECRET;
        expect(isMediaSigningEnabled()).toBe(false);
        expect(signMediaUrl('https://api.example.kz/static/a.webp', NOW)).toBe(
            'https://api.example.kz/static/a.webp',
        );
    });

    describe('signMediaUrlsInHtml — картинки внутри описаний', () => {
        const API = 'https://api.example.kz';
        const originalApi = process.env.API_URL;

        beforeEach(() => {
            process.env.API_URL = API;
        });

        afterAll(() => {
            if (originalApi === undefined) delete process.env.API_URL;
            else process.env.API_URL = originalApi;
        });

        it('подписывает картинку и достраивает её до API-хоста', () => {
            // Ключевой случай: Tiptap пишет относительный путь, и у студента он
            // уходил на домен приложения, где /static/ нет вовсе — 404.
            const out = signMediaUrlsInHtml('<img src="/static/courses/a.png" alt="Снимок.png">', NOW);
            expect(out).toContain(`src="${API}/static/courses/a.png?`);
            expect(out).toContain('md5=');
            expect(out).toContain('expires=');
            expect(out).toContain('alt="Снимок.png"');
        });

        it('подписывает несколько ссылок в одной строке', () => {
            const out = signMediaUrlsInHtml(
                '<img src="/static/a.png"><p>и</p><img src="/static/b.png">',
                NOW,
            );
            expect(out.match(/md5=/g)).toHaveLength(2);
        });

        it('не трогает чужие ссылки и якоря', () => {
            const html = '<a href="https://youtube.com/x">видео</a><img src="https://cdn.example/y.png">';
            expect(signMediaUrlsInHtml(html, NOW)).toBe(html);
        });

        it('не подписывает дважды', () => {
            const once = signMediaUrlsInHtml('<img src="/static/a.png">', NOW);
            expect(signMediaUrlsInHtml(once, NOW + 60_000)).toBe(once);
        });

        it('подписывает href — файл по ссылке закрыт так же, как картинка', () => {
            const out = signMediaUrlsInHtml('<a href="/static/courses/doc.pdf">файл</a>', NOW);
            expect(out).toContain('md5=');
        });

        it('строку без /static/ возвращает мгновенно и без изменений', () => {
            const html = '<p>обычный текст без картинок</p>';
            expect(signMediaUrlsInHtml(html, NOW)).toBe(html);
        });

        it('работает и с одинарными кавычками', () => {
            const out = signMediaUrlsInHtml("<img src='/static/a.png'>", NOW);
            expect(out).toContain('md5=');
            expect(out).toContain("src='");
        });
    });

    describe('looksLikeHtml', () => {
        it('отличает разметку от ссылки', () => {
            expect(looksLikeHtml('<p>текст</p>')).toBe(true);
            expect(looksLikeHtml('<img src="/static/a.png">')).toBe(true);
            expect(looksLikeHtml('https://api.example.kz/static/a.png')).toBe(false);
            expect(looksLikeHtml('/static/a.png')).toBe(false);
            expect(looksLikeHtml('просто текст')).toBe(false);
        });
    });
});
