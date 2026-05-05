/**
 * D-21 (Phase 9 CONTEXT): per-surface Redis namespace for Kaspi payments.
 *
 * Plan 02 wire-up:
 *   - List endpoint reads/writes through PAYMENTS_LIST_PREFIX:<query-fingerprint>.
 *   - Detail endpoint reads/writes through PAYMENTS_DETAIL_PREFIX:<id>.
 *   - Export endpoint is NOT cached (mirrors USR-07 export pattern).
 *   - There are NO mutations on KaspiPayment from admin-api (read-only surface),
 *     so the invalidate pattern is provided for symmetry / future-proofing only.
 *
 * Mirrors STORIES_INVALIDATE_PATTERN from
 * glucose-admin-api/src/modules/stories/utils/stories-cache.ts.
 */
export const PAYMENTS_CACHE_NAMESPACE = 'geonline-admin:payments';
export const PAYMENTS_LIST_PREFIX = `${PAYMENTS_CACHE_NAMESPACE}:list`;
export const PAYMENTS_DETAIL_PREFIX = `${PAYMENTS_CACHE_NAMESPACE}:detail`;
export const PAYMENTS_INVALIDATE_PATTERN = `${PAYMENTS_CACHE_NAMESPACE}:*`;
