/**
 * D-19 (Phase 7 CONTEXT): per-surface Redis namespace for advertisement banners.
 *
 * Plan 03 wire-up:
 *   - List endpoint reads/writes through BANNERS_LIST_PREFIX:<query-fingerprint>.
 *   - Detail endpoint reads/writes through BANNERS_DETAIL_PREFIX:<id>.
 *   - Categories list reads/writes through BANNERS_CATEGORIES_PREFIX.
 *   - Every mutation invalidates BANNERS_INVALIDATE_PATTERN (whole namespace).
 *
 * "Banners" is product-facing nomenclature for the Prisma `Advertisement` model
 * (DB table `advertisements`). The namespace stays under the `banners` keyword to
 * keep cache keys aligned with the URL surface admin operators see.
 */
export const BANNERS_LIST_PREFIX = 'geonline-admin:banners:list';
export const BANNERS_DETAIL_PREFIX = 'geonline-admin:banners:detail';
export const BANNERS_CATEGORIES_PREFIX = 'geonline-admin:banners:categories';
export const BANNERS_INVALIDATE_PATTERN = 'geonline-admin:banners:*';
