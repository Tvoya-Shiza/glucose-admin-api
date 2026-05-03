import type { ScopeRules } from '../../common/scoping/scope.types';

/**
 * CRS-01..09 RBAC data scope (D-19 from Phase 5 CONTEXT).
 *
 *   admin   → omitted → buildScopeWhere returns {} (sees all courses)
 *   teacher → only courses where Webinar.teacher_id === actor.id
 *   curator → default-deny (id: { in: [] }) — curators don't author courses
 *
 * Spread into prisma.webinar.findMany({ where: { ...filters, ...buildScopeWhere(actor, WEBINAR_SCOPE_RULES) } }).
 *
 * Per CONTEXT D-19 + ROADMAP §Phase 5 success criterion #4, a teacher hitting
 * another teacher's course MUST receive 403 (handled in Plan 03's detail
 * service — same 3-step pattern Phase 4 Plan 03 used for Groups).
 *
 * Relation names verified against glucose-admin-api/prisma/schema.prisma
 * Webinar.teacher_id at line 806 (FK to User.id).
 */
export const WEBINAR_SCOPE_RULES: ScopeRules = {
    // admin: omitted -> buildScopeWhere returns {} -> sees all courses
    teacher: (actor) => ({ teacher_id: actor.id }),
    curator: () => ({ id: { in: [] as number[] } }),
};
