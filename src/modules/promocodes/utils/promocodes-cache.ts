/**
 * D-19 (Phase 7 CONTEXT): per-surface Redis namespace for promocodes.
 *
 * Plan 05 wire-up:
 *   - List endpoint reads/writes through PROMOCODES_LIST_PREFIX:<query-fingerprint>.
 *   - Detail endpoint reads/writes through PROMOCODES_DETAIL_PREFIX:<id>.
 *   - Usage list reads/writes through PROMOCODES_USAGES_PREFIX:<promocode_id>.
 *   - Every mutation invalidates PROMOCODES_INVALIDATE_PATTERN (whole namespace).
 *
 * Note: promocodes have no categories surface (D-13 — distinct model from
 * Stories/Banners/Blogs which all share the BlogStatus enum + flat category pattern).
 */
export const PROMOCODES_LIST_PREFIX = 'geonline-admin:promocodes:list';
export const PROMOCODES_DETAIL_PREFIX = 'geonline-admin:promocodes:detail';
export const PROMOCODES_USAGES_PREFIX = 'geonline-admin:promocodes:usages';
export const PROMOCODES_INVALIDATE_PATTERN = 'geonline-admin:promocodes:*';
