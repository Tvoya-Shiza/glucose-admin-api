import { createHash } from 'node:crypto';

/**
 * Phase 38 — trainer admin-surface cache helpers.
 *
 * Copied from the quizzes cache pattern (src/modules/quizzes/utils/quizzes-cache.ts).
 *
 * Namespace: `geonline-admin:trainers:*`
 *
 * - Reads cached at `geonline-admin:trainers:<surface>:<role>:<actor_id>:<sha1(json(filters))>`.
 *   Role + actor_id BEFORE the filter hash so admin's cache slot can never be served to a
 *   teacher (same threat model as T-06-07 in the quizzes plan).
 * - Writes invalidate the entire `geonline-admin:trainers:*` namespace via the pattern-delete
 *   helper, AND the student-facing `geonline:trainers:*` namespace: glucose-api caches the
 *   public trainer catalog/categories in the SAME Redis instance under that prefix (precedent:
 *   BLOGS_PUBLIC_INVALIDATE_PATTERN in src/modules/blogs/utils/blogs-cache.ts), so admin
 *   mutations must nuke both for students to see changes immediately.
 */

export const TRAINERS_INVALIDATE_PATTERN = 'geonline-admin:trainers:*';

// Student-facing glucose-api namespace (list/detail/categories caches, 300s/3600s TTLs).
export const TRAINERS_PUBLIC_INVALIDATE_PATTERN = 'geonline:trainers:*';

function hashFilters(filters: Record<string, unknown>): string {
    const sortedKeys = Object.keys(filters).sort();
    const normalized = JSON.stringify(filters, sortedKeys);
    return createHash('sha1').update(normalized).digest('hex').slice(0, 16);
}

/**
 * Cache key for GET /admin-api/v1/admin/trainers (60s TTL).
 *
 * @param role     The actor's role_name (admin|curator|teacher).
 * @param actor_id The actor's User.id (Int).
 * @param filters  The validated ListTrainersDto from the controller.
 */
export function buildTrainerListCacheKey(role: string, actor_id: number, filters: Record<string, unknown>): string {
    return `geonline-admin:trainers:list:${role}:${actor_id}:${hashFilters(filters)}`;
}

/**
 * Cache key for the trainer-results surfaces (30s TTL).
 *
 * @param surface  'list' | 'stats' — disjoint slots per endpoint.
 */
export function buildTrainerResultsCacheKey(
    surface: 'list' | 'stats',
    role: string,
    actor_id: number,
    filters: Record<string, unknown>,
): string {
    return `geonline-admin:trainers:results:${surface}:${role}:${actor_id}:${hashFilters(filters)}`;
}
