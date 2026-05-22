import { createHash } from 'node:crypto';

/**
 * D-21 + D-22 (Phase 9 CONTEXT): per-surface Redis namespace + cache-key
 * composition for analytics dashboards.
 *
 * Plan 04 wire-up:
 *   - Each dashboard endpoint caches its response for 5 minutes (D-14) keyed by
 *     (surface, role, actor_id, filter_hash). The surface segment ensures
 *     cross-endpoint isolation; actor_id ensures one curator/teacher cannot
 *     read another's narrowed view (T-09-01-04 spoofing mitigation).
 *   - filter_hash is a SHA-256 truncation of the JSON-stringified filter object
 *     with sorted keys, so semantically-equal queries hit the same entry
 *     regardless of property iteration order.
 *   - 5-min TTL with no jitter — accepted DoS posture for v1 (T-09-01-05).
 *
 * Mirrors STORIES_INVALIDATE_PATTERN style from
 * glucose-admin-api/src/modules/stories/utils/stories-cache.ts.
 */
export const ANALYTICS_CACHE_NAMESPACE = 'geonline-admin:analytics';
export const ANALYTICS_TTL_SECONDS = 5 * 60;
export const ANALYTICS_INVALIDATE_PATTERN = `${ANALYTICS_CACHE_NAMESPACE}:*`;

/**
 * Surface segments — one per dashboard endpoint. Used as the second segment of
 * the cache key so that an admin-kpi miss does not stampede a curator-overview
 * computation, and vice-versa.
 */
export type AnalyticsSurface = 'admin-kpi' | 'curator-overview' | 'teacher-overview' | 'quiz-results-stats';

/**
 * Build a deterministic cache key for an analytics endpoint.
 *
 * Filter object is JSON-stringified with keys sorted top-level so semantically
 * equal filter shapes hit the same cache entry regardless of property
 * iteration order. The 16-char SHA-256 hex prefix is plenty of entropy for a
 * keyspace already partitioned by (surface, role, actor_id) — collision risk
 * here is informational only, not a security boundary.
 *
 * Example output:
 *   geonline-admin:analytics:admin-kpi:admin:42:9f86d081884c7d65
 */
export function buildAnalyticsCacheKey(
    surface: AnalyticsSurface,
    role: string,
    actor_id: number,
    filter: Record<string, unknown>,
): string {
    const sorted = Object.keys(filter)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
            acc[k] = filter[k];
            return acc;
        }, {});
    const hash = createHash('sha256').update(JSON.stringify(sorted)).digest('hex').slice(0, 16);
    return `${ANALYTICS_CACHE_NAMESPACE}:${surface}:${role}:${actor_id}:${hash}`;
}
