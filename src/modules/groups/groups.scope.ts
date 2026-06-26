import type { ScopeRules } from '../../common/scoping/scope.types';

/**
 * GROUP_SCOPE_RULES — Phase 4 GRP-05 (D-18 from CONTEXT.md).
 *
 *   admin   → omitted → buildScopeWhere returns {} (sees all groups)
 *   curator → narrows to groups they supervise: { supervisor_id: actor.id }
 *   teacher → omitted → buildScopeWhere returns {} → governed by @RequirePermission.
 *               When granted groups.view, a teacher sees all groups (no per-tenant
 *               row narrowing for teachers currently exists).
 *
 * Spread into prisma.group.findMany({ where: { ...filters, ...buildScopeWhere(actor, GROUP_SCOPE_RULES) } }).
 * Plans 02-04 list/detail/mutation services MUST spread this — forgetting it leaks data
 * (T-04-01 in plan threat model). GRP-05 verifies a curator hitting another curator's
 * Group returns 403 (not 404, not 200).
 *
 * NOTE on Group schema gaps (verified against glucose-admin-api/prisma/schema.prisma 2026-04-30):
 *   - No `deleted_at` column. DELETE = hard delete via prisma.group.delete()
 *     (cascade FKs are onDelete: Cascade on group_users + chapter_schedules).
 *     "Deactivate" = status='inactive' via PATCH /groups/:id (D-11 resolution).
 *   - No `created_at` column. List sort by `created_at` is mapped to { id: order }
 *     (autoincrement id is monotonic; safe proxy). GroupRowDto.created_at is null
 *     until the schema gains the column.
 *   - GroupUser has no @@unique([user_id, group_id]); add path uses findMany
 *     (existing-row probe) + createMany (insert deltas), same as Phase 3 Plan 03
 *     users-detail.service.ts patchMemberships.
 *
 * Relation names verified against schema.prisma Group model
 * (id at line 300, supervisor_id at line 302, name at line 303, status at line 304).
 */
export const GROUP_SCOPE_RULES: ScopeRules = {
    // admin: omitted -> buildScopeWhere returns {} -> sees all groups
    curator: (actor) => ({ supervisor_id: actor.id }),
    // teacher: omitted -> buildScopeWhere returns {} -> governed by @RequirePermission
};
