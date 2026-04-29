/**
 * Normalize a KZ phone number to canonical +7XXXXXXXXXX form (D-24).
 *
 * Accepts:
 *   +7XXXXXXXXXX (already canonical)         -> returned unchanged
 *   8XXXXXXXXXX                              -> '+7' + last 10 digits
 *   77XXXXXXXXX (11 digits starting with 7)  -> '+' + value
 *
 * Optional whitespace, hyphens, and parentheses are stripped before validation.
 * Anything that doesn't match one of the accepted shapes returns null — callers
 * should treat null as "invalid; reject the write" (Plan 03 profile patch,
 * Plan 06 import).
 */
export function normalizeKzPhone(input: string | null | undefined): string | null {
    if (!input) return null;
    const trimmed = String(input).replace(/\s|-|\(|\)/g, '');
    if (/^\+7\d{10}$/.test(trimmed)) return trimmed;
    if (/^8\d{10}$/.test(trimmed)) return '+7' + trimmed.slice(1);
    if (/^7\d{10}$/.test(trimmed)) return '+' + trimmed;
    return null;
}
