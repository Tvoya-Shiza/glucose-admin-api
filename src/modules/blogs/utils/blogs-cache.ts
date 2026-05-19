/**
 * D-19 (Phase 7 CONTEXT): per-surface Redis namespace for blogs.
 *
 * Plan 04 wire-up:
 *   - List endpoint reads/writes through BLOGS_LIST_PREFIX:<query-fingerprint>.
 *   - Detail endpoint reads/writes through BLOGS_DETAIL_PREFIX:<id>.
 *   - Categories list reads/writes through BLOGS_CATEGORIES_PREFIX.
 *   - Every mutation invalidates BLOGS_INVALIDATE_PATTERN (whole namespace).
 */
export const BLOGS_LIST_PREFIX = 'geonline-admin:blogs:list';
export const BLOGS_DETAIL_PREFIX = 'geonline-admin:blogs:detail';
export const BLOGS_CATEGORIES_PREFIX = 'geonline-admin:blogs:categories';
export const BLOGS_INVALIDATE_PATTERN = 'geonline-admin:blogs:*';

// Public glucose-api shares the same Redis instance under a separate namespace.
// Mutations here MUST also nuke the public namespace so the public list endpoint
// (12h TTL) reflects admin changes immediately.
export const BLOGS_PUBLIC_INVALIDATE_PATTERN = 'geonline:blogs:*';
