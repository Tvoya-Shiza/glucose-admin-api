/**
 * CRS-02 translation-completeness helper.
 *
 * 'complete' iff for both 'ru' and 'kz' there is at least one translation
 * row with a non-empty title (description is NOT required for completeness
 * — it is optional in the schema as LongText).
 *
 * Used by:
 *   - Plan 02 list service (per-row aggregate over the embedded translations array)
 *   - Plan 03 detail service (single course)
 *
 * Pure function. No Prisma dependency. Must remain framework-free so it can be
 * imported from anywhere without dragging Nest providers along.
 *
 * Schema-truth note: WebinarTranslations.locale is a free-form String column
 * (no FK, no enum, no @@unique on (webinar_id, locale)). The locked DTO contract
 * narrows incoming locale values to 'ru' | 'kz' at the API boundary; downstream
 * the same union is treated as authoritative — any other locale row in the DB
 * is ignored by this helper.
 */
export type Locale = 'ru' | 'kz';
export const REQUIRED_LOCALES: Locale[] = ['ru', 'kz'];

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
