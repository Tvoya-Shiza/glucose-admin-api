import DOMPurify from 'isomorphic-dompurify';

/**
 * Server-side Tiptap HTML sanitizer for LessonSchedule.description.
 *
 * The schedule description is an admin-authored rich-text field rendered to
 * students in the student app (which trusts pre-sanitized HTML). The client
 * sanitizes before sending, but this is the FINAL gate — a tampered client
 * cannot bypass it. Whitelist mirrors the Tiptap editor surface and the other
 * module sanitizers (courses/quizzes/blogs) — keep them in sync when the
 * editor's extension list changes.
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

/**
 * Sanitize the schedule description and collapse "visually empty" content to
 * null. Tiptap serializes a cleared editor as `<p></p>`, which would otherwise
 * be stored as a non-null-but-blank value and render as an empty paragraph.
 * Content with text OR an image is considered meaningful and kept.
 */
export function normalizeScheduleDescription(html: string | null | undefined): string | null {
    const clean = sanitizeTiptapHtmlServer(html);
    if (!clean) return null;
    const hasText = clean.replace(/<[^>]*>/g, '').trim().length > 0;
    const hasMedia = /<img\b/i.test(clean);
    return hasText || hasMedia ? clean : null;
}

/** Internal export — for parity tests / debug only. */
export const __SERVER_SANITIZE_INTERNAL = { ALLOWED_TAGS, ALLOWED_ATTR, FORBID_TAGS, FORBID_ATTR };
