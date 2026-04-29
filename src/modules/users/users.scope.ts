import type { ScopeRules } from '../../common/scoping/scope.types';

/**
 * USR-01..USR-08 RBAC data scope (D-21 from CONTEXT).
 *
 *   admin   → omitted → buildScopeWhere returns {} (sees all users)
 *   curator → only users in groups where actor is supervisor
 *               relation: User.group_users -> GroupUser.group -> Group.supervisor_id
 *   teacher → only users who bought a webinar where actor is the teacher
 *               relation: User.sales_as_buyer -> Sale.webinar -> Webinar.teacher_id
 *
 * Spread into prisma.user.findMany({ where: { ...filters, ...buildScopeWhere(actor, USER_SCOPE_RULES) } }).
 * Plan 02 list service + Plan 03 detail service MUST spread this — forgetting it leaks data
 * (T-03-01 in plan threat model). Phase 4 verifies cross-scope access returns 403/404.
 *
 * Relation names verified against glucose-admin-api/prisma/schema.prisma User model
 * (group_users at line 258, sales_as_buyer at line 271, supervisor_id at line 302,
 * Webinar.teacher_id at line 806).
 */
export const USER_SCOPE_RULES: ScopeRules = {
    // admin: omitted -> buildScopeWhere returns {} -> sees all users
    curator: (actor) => ({
        group_users: { some: { group: { supervisor_id: actor.id } } },
    }),
    teacher: (actor) => ({
        sales_as_buyer: { some: { webinar: { teacher_id: actor.id } } },
    }),
};
