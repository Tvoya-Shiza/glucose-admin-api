/**
 * D-21 (Phase 9 CONTEXT): per-surface Redis namespace for sales / orders.
 *
 * Plan 03 wire-up:
 *   - List endpoint reads/writes through SALES_LIST_PREFIX:<query-fingerprint>.
 *   - Detail endpoint reads/writes through SALES_DETAIL_PREFIX:<id>.
 *   - Export endpoint is NOT cached (mirrors USR-07 export pattern).
 *   - Refund mutation invalidates SALES_INVALIDATE_PATTERN (whole namespace).
 *
 * Mirrors STORIES_INVALIDATE_PATTERN style from
 * glucose-admin-api/src/modules/stories/utils/stories-cache.ts.
 */
export const SALES_CACHE_NAMESPACE = 'geonline-admin:sales';
export const SALES_LIST_PREFIX = `${SALES_CACHE_NAMESPACE}:list`;
export const SALES_DETAIL_PREFIX = `${SALES_CACHE_NAMESPACE}:detail`;
export const SALES_INVALIDATE_PATTERN = `${SALES_CACHE_NAMESPACE}:*`;
