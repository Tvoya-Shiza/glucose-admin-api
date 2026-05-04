import DOMPurify from 'isomorphic-dompurify';

/**
 * Server-side Tiptap HTML sanitizer for blog content (T-07-04-02 mitigation —
 * defense in depth).
 *
 * Whitelist mirrors `glucose-admin-api/src/modules/courses/utils/sanitize-html-server.ts`
 * (Phase 5 Plan 05) and `glucose-admin-client/src/lib/sanitize/sanitize-html.ts`
 * (Phase 5 Plan 01). The server side is the FINAL gate — even a tampered admin-client
 * cannot bypass this. Sanitization runs on every write that touches
 * BlogTranslation.content.
 *
 * Plan 04 deliberately copies the whitelist VERBATIM rather than extracting a shared
 * util — keeps the two surfaces independent during Phase 7 wave 2 (parallel with
 * Plans 02/03/05). A future refactor can DRY them.
 *
 * Keep ALLOWED_TAGS / ALLOWED_ATTR in lockstep with:
 *   - glucose-admin-api/src/modules/courses/utils/sanitize-html-server.ts (Phase 5)
 *   - glucose-admin-client/src/lib/sanitize/sanitize-html.ts (Phase 5)
 *
 * Mismatches show up as a "valid on client, stripped on server" bug — log them via
 * the dev console + adjust both files.
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

export function sanitizeBlogHtmlServer(html: string | null | undefined): string {
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
