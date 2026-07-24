import { createHash } from 'node:crypto';

/**
 * Phase 39/40 — ebooks admin-surface cache helpers.
 *
 * Copied from the trainers/quizzes cache pattern
 * (src/modules/trainers/utils/trainers-cache.ts).
 *
 * Namespace: `geonline-admin:ebooks:*`
 *
 * - Reads cached at `geonline-admin:ebooks:<surface>:<role>:<actor_id>:<sha1(json(filters))>`.
 *   Role + actor_id BEFORE the filter hash so admin's cache slot can never be served to a
 *   teacher (same threat model as the trainers/quizzes plans).
 * - Writes invalidate the entire `geonline-admin:ebooks:*` namespace via the pattern-delete
 *   helper, AND the student-facing `geonline:books:*` namespace: glucose-api caches the
 *   public book catalog/detail in the SAME Redis instance under that prefix (precedent:
 *   BLOGS_PUBLIC_INVALIDATE_PATTERN in src/modules/blogs/utils/blogs-cache.ts), so admin
 *   mutations must nuke both for students to see changes immediately.
 */

export const EBOOKS_INVALIDATE_PATTERN = 'geonline-admin:ebooks:*';

// Student-facing glucose-api namespace (public book list/detail caches).
export const EBOOKS_PUBLIC_INVALIDATE_PATTERN = 'geonline:books:*';

function hashFilters(filters: Record<string, unknown>): string {
    const sortedKeys = Object.keys(filters).sort();
    const normalized = JSON.stringify(filters, sortedKeys);
    return createHash('sha1').update(normalized).digest('hex').slice(0, 16);
}

/**
 * Cache key for GET /admin-api/v1/admin/ebooks (60s TTL).
 *
 * @param role     The actor's role_name (admin|curator|teacher).
 * @param actor_id The actor's User.id (Int).
 * @param filters  The validated ListBooksDto from the controller.
 */
export function buildBookListCacheKey(role: string, actor_id: number, filters: Record<string, unknown>): string {
    return `geonline-admin:ebooks:list:${role}:${actor_id}:${hashFilters(filters)}`;
}
