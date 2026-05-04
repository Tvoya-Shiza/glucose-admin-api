/**
 * D-19 (Phase 7 CONTEXT): per-surface Redis namespace for stories.
 *
 * Plans 02 wire-up:
 *   - List endpoint reads/writes through STORIES_LIST_PREFIX:<query-fingerprint>.
 *   - Detail endpoint reads/writes through STORIES_DETAIL_PREFIX:<id>.
 *   - Categories list reads/writes through STORIES_CATEGORIES_PREFIX.
 *   - Every mutation invalidates STORIES_INVALIDATE_PATTERN (whole namespace).
 *
 * Mirrors COURSES_INVALIDATE_PATTERN style from
 * glucose-admin-api/src/modules/courses/utils/courses-cache.service.ts.
 */
export const STORIES_LIST_PREFIX = 'geonline-admin:stories:list';
export const STORIES_DETAIL_PREFIX = 'geonline-admin:stories:detail';
export const STORIES_CATEGORIES_PREFIX = 'geonline-admin:stories:categories';
export const STORIES_INVALIDATE_PATTERN = 'geonline-admin:stories:*';
