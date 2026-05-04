/** D-18 (Phase 8 CONTEXT): per-surface Redis namespace. */
export const PUSH_AUDIENCE_PREFIX = 'geonline-admin:push:audience'; // Plan 02 — 30s TTL
export const PUSH_HISTORY_PREFIX = 'geonline-admin:push:history'; // Plan 03 — 60s TTL
export const PUSH_SCHEDULED_PREFIX = 'geonline-admin:push:scheduled'; // Plan 04 — 60s TTL
export const PUSH_INVALIDATE_PATTERN = 'geonline-admin:push:*';
