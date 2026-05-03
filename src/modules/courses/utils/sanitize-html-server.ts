import DOMPurify from 'isomorphic-dompurify';

/**
 * Server-side Tiptap HTML sanitizer (T-05-30 mitigation — defense in depth).
 *
 * Whitelist mirrors `glucose-admin-client/src/lib/sanitize/sanitize-html.ts`
 * (Plan 01). The server side is the FINAL gate — even a tampered admin-client
 * cannot bypass this. Sanitization runs on every write that touches
 * FileTranslations.description (per-locale rich-text body for type='file' items).
 *
 * Keep ALLOWED_TAGS / ALLOWED_ATTR in sync with the client whitelist when adding
 * Tiptap extensions. Mismatches show up as a "valid on client, stripped on server"
 * bug — log them via the dev console + adjust both files.
 */
const ALLOWED_TAGS = [
    'p',
    'br',
    'strong',
    'em',
    'u',
    's',
    'h1',
    'h2',
    'h3',
    'ul',
    'ol',
    'li',
    'a',
    'img',
    'pre',
    'code',
    'blockquote',
];

const ALLOWED_ATTR = ['href', 'src', 'alt', 'title', 'target', 'rel', 'class'];

const FORBID_TAGS = ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button'];

const FORBID_ATTR = ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur', 'onkeydown', 'onkeyup'];

export function sanitizeTiptapHtmlServer(html: string | null | undefined): string {
    if (!html) return '';
    return DOMPurify.sanitize(html, {
        ALLOWED_TAGS,
        ALLOWED_ATTR,
        ALLOW_DATA_ATTR: false,
        FORBID_TAGS,
        FORBID_ATTR,
    });
}

/** Internal export — for parity tests / debug only. */
export const __SERVER_SANITIZE_INTERNAL = { ALLOWED_TAGS, ALLOWED_ATTR, FORBID_TAGS, FORBID_ATTR };
