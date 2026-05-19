import type { ScopeRules } from '../../common/scoping/scope.types';

/**
 * BoardsModule data scope (D-21 analogue for Phase 12).
 *
 *   admin   → omitted → buildScopeWhere returns {} (sees every board)
 *   curator → only boards where the actor is a member (via kanban_board_members)
 *   teacher → same rule as curator
 *
 * Custom roles (created via /access/roles) flow through the default branch in
 * buildScopeWhere, which fails-closed with `{ id: { in: [] } }`. To grant a
 * custom role read access to a board, the admin must add the role's users
 * explicitly to that board's member roster — there's intentionally no
 * "all-roles-see-all-boards" sentinel, since boards are private-by-default
 * per stakeholder agreement.
 *
 * The relation `members: { some: { user_id: actor.id } }` resolves via
 * KanbanBoardMember.user_id → kanban_board_members.user_id (see
 * glucose-api/prisma/schema.prisma Phase 12 block).
 */
export const BOARD_SCOPE_RULES: ScopeRules = {
    curator: (actor) => ({ members: { some: { user_id: actor.id } } }),
    teacher: (actor) => ({ members: { some: { user_id: actor.id } } }),
};
