import type { ScopeActor } from '../../../common/scoping/scope.types';
import type { ListCoursesDto } from '../dto/list-courses.dto';

/**
 * Cache-key helpers for the courses-list / detail endpoints (Plans 02/03 consume
 * via CacheService.getOrSet). Keys are scoped per actor so teacher narrowing
 * never leaks across users.
 *
 * Namespace: geonline-admin:courses:* (CONTEXT D-25 — invalidate aggressively
 * on any course-tree mutation).
 *
 * Mirrors Phase 4 group-cache.ts shape verbatim.
 */
export const COURSES_INVALIDATE_PATTERN = 'geonline-admin:courses:*';
export const COURSES_LIST_INVALIDATE_PATTERN = 'geonline-admin:courses:list:*';
export const COURSES_DETAIL_INVALIDATE_PATTERN = 'geonline-admin:courses:detail:*';

export function buildCourseListCacheKey(actor: ScopeActor, q: ListCoursesDto): string {
    const parts = [
        'geonline-admin:courses:list',
        `p${q.page ?? 1}`,
        `s${q.page_size ?? 50}`,
        `st${q.status ?? '_'}`,
        `t${q.teacher_id ?? '_'}`,
        `c${q.category_id ?? '_'}`,
        `tc${q.translation_completeness ?? '_'}`,
        `q${(q.q ?? '').toLowerCase().trim().slice(0, 32)}`,
        `o${q.sort ?? 'created_at'}-${q.order ?? 'desc'}`,
        `scope:${actor.role_name}:${actor.id}`,
    ];
    return parts.join(':');
}

export function buildCourseDetailCacheKey(actor: ScopeActor, courseId: number): string {
    return `geonline-admin:courses:detail:${courseId}:scope:${actor.role_name}:${actor.id}`;
}
