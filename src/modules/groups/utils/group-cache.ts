import type { ScopeActor } from '../../../common/scoping/scope.types';
import type { ListGroupsDto } from '../dto/list-groups.dto';

/**
 * Cache-key helper for the groups-list endpoint (Plan 02 consumes via CacheService.getOrSet).
 * Keys are scoped per actor so curator narrowing never leaks across users.
 *
 * Namespace: geonline-admin:groups:list:<filters>:scope:<role>:<actor_id>
 *
 * Mirrors the Phase 3 buildUserListCacheKey shape verbatim — see
 * glucose-admin-api/src/modules/users/utils/user-list-cache.ts.
 */
export const GROUPS_LIST_INVALIDATE_PATTERN = 'geonline-admin:groups:list:*';
export const GROUPS_DETAIL_INVALIDATE_PATTERN = 'geonline-admin:groups:detail:*';

export function buildGroupListCacheKey(actor: ScopeActor, q: ListGroupsDto): string {
    const parts = [
        'geonline-admin:groups:list',
        `p${q.page ?? 1}`,
        `s${q.page_size ?? 50}`,
        `st${q.status ?? '_'}`,
        `sup${q.supervisor_id ?? '_'}`,
        `mb${q.member_count_bucket ?? '_'}`,
        `q${(q.q ?? '').toLowerCase().trim().slice(0, 32)}`,
        `o${q.sort ?? 'created_at'}-${q.order ?? 'desc'}`,
        `c${q.cursor ?? '_'}`,
        `scope:${actor.role_name}:${actor.id}`,
    ];
    return parts.join(':');
}
