/**
 * CRS-02 translation-completeness helper.
 *
 * 'complete' iff for 'kz' there is at least one translation row with a
 * non-empty title (description is NOT required for completeness — it is
 * optional in the schema as LongText).
 *
 * Schema-truth note: WebinarTranslations.locale is a free-form String column
 * (no FK, no enum, no @@unique on (webinar_id, locale)). Legacy 'ru' rows may
 * exist in the DB but are dormant; this helper ignores any non-'kz' locale.
 */
export type Locale = 'kz';
export const REQUIRED_LOCALES: Locale[] = ['kz'];

export interface TranslationLite {
    locale: string;
    title: string | null;
}

export function deriveTranslationCompleteness(translations: TranslationLite[]): {
    translation_completeness: 'complete' | 'incomplete';
    missing_locales: Locale[];
} {
    const present = new Set<Locale>();
    for (const t of translations) {
        if (REQUIRED_LOCALES.includes(t.locale as Locale) && (t.title ?? '').trim().length > 0) {
            present.add(t.locale as Locale);
        }
    }
    const missing = REQUIRED_LOCALES.filter((l) => !present.has(l));
    return {
        translation_completeness: missing.length === 0 ? 'complete' : 'incomplete',
        missing_locales: missing,
    };
}
