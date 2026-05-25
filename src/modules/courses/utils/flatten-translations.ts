/**
 * Maps an array of `{locale, title}` translation rows (any superset shape) to
 * `{title_kz, title_ru}`. Used by the picker-items service to produce a stable
 * wire shape regardless of which entity table the row came from.
 */
export interface TranslationLike {
    locale: string;
    title: string | null;
}

export function flattenTranslationsToTitles(
    translations: TranslationLike[] | null | undefined,
): { title_kz: string | null; title_ru: string | null } {
    if (!translations || translations.length === 0) {
        return { title_kz: null, title_ru: null };
    }
    let title_kz: string | null = null;
    let title_ru: string | null = null;
    for (const t of translations) {
        if (title_kz === null && t.locale === 'kz') title_kz = t.title ?? null;
        if (title_ru === null && t.locale === 'ru') title_ru = t.title ?? null;
    }
    return { title_kz, title_ru };
}
