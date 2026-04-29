import type { ListUsersDto } from '../dto/list-users.dto';

/**
 * Cache-key helper for the users-list endpoint (Plan 02 consumes via CacheService.getOrSet).
 * Keys are scoped per actor so curator/teacher narrowing never leaks across users.
 *
 * Namespace: geonline-admin:users:list:<filters>:scope:<role>:<actor_id>
 */
export function buildUserListCacheKey(actor: { id: number; role_name: string }, q: ListUsersDto): string {
    const parts = [
        'geonline-admin:users:list',
        `p${q.page ?? 1}`,
        `s${q.page_size ?? 50}`,
        `r${q.role_name ?? 'any'}`,
        `st${q.status ?? 'any'}`,
        `rg${q.region_id ?? 'any'}`,
        `q${(q.q ?? '').toLowerCase().trim().slice(0, 32)}`,
        `o${q.sort ?? 'created_at'}-${q.order ?? 'desc'}`,
        `c${q.cursor ?? 'none'}`,
        `scope:${actor.role_name}:${actor.id}`,
    ];
    return parts.join(':');
}

/** Pattern to invalidate every users:list cache entry (used by Plan 03 + 04 + 05 + 06 mutations). */
export const USERS_LIST_INVALIDATE_PATTERN = 'geonline-admin:users:list:*';
