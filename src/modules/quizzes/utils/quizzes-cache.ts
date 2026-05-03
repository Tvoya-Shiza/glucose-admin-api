import { createHash } from 'node:crypto';
import type { ListQuizzesDto } from '../dto/list-quizzes.dto';

/**
 * QZ-01..09 cache helpers (D-26).
 *
 * Phase 6 Plan 01 — locked contract surface.
 * Consumed by Plans 02-07 (anywhere a list endpoint or invalidation runs).
 *
 * Namespace: `geonline-admin:quizzes:*`
 *
 * - Reads cached at `geonline-admin:quizzes:list:<role>:<actor_id>:<sha1(json(filters))>`.
 *   Role + actor_id BEFORE the filter hash so admin's cache cannot be served to a teacher
 *   (T-06-07 in this plan's threat model).
 * - Writes invalidate the entire `geonline-admin:quizzes:*` namespace via the existing
 *   pattern-delete helper (mirrors Phase 5 courses pattern). Aggressive on purpose: quiz
 *   detail / list / question / badge writes all touch each other.
 */

export const QUIZZES_INVALIDATE_PATTERN = 'geonline-admin:quizzes:*';

/**
 * Build a deterministic cache key for the list endpoint.
 *
 * Filters are canonicalized by sorting JSON keys before hashing so that
 * `{ page: 1, status: 'active' }` and `{ status: 'active', page: 1 }` produce
 * the same cache slot. Only the first 16 hex chars of sha1 are used (64 bits)
 * — collision probability negligible at the workload sizes we expect.
 *
 * @param role     The actor's role_name (admin|curator|teacher).
 * @param actor_id The actor's User.id (Int).
 * @param filters  The validated ListQuizzesDto from the controller.
 */
export function buildQuizListCacheKey(role: string, actor_id: number, filters: ListQuizzesDto): string {
    const sortedKeys = Object.keys(filters as Record<string, unknown>).sort();
    const normalized = JSON.stringify(filters, sortedKeys);
    const hash = createHash('sha1').update(normalized).digest('hex').slice(0, 16);
    return `geonline-admin:quizzes:list:${role}:${actor_id}:${hash}`;
}
