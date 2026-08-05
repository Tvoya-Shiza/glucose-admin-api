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
    mediaKindFromPath,
    signMediaUrl,
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

    it('без секрета отдаёт ссылку как есть: разработка и незаполненный .env не должны падать', () => {
        delete process.env.MEDIA_SIGNING_SECRET;
        expect(isMediaSigningEnabled()).toBe(false);
        expect(signMediaUrl('https://api.example.kz/static/a.webp', NOW)).toBe(
            'https://api.example.kz/static/a.webp',
        );
    });
});
