import type { RoleName } from '@shared/roles';

/**
 * Minimal actor identity used by scope rules.
 * Matches AuthenticatedRequestUser from jwt.strategy.ts (Plan 02), narrowed to the
 * fields scope rules actually need. Intentional duplication so common/scoping
 * does not depend on auth/jwt internals.
 */
export interface ScopeActor {
    id: number;
    role_name: RoleName;
}

/**
 * Prisma-where fragment. Keys are model field names; values are Prisma operators.
 * Loosely typed (`unknown`) here so the helper is reusable across models;
 * call sites cast to the specific Prisma model's WhereInput.
 */
export type ScopeFragment = Record<string, unknown>;

/**
 * Per-feature scoping rules. Phases 3+ implement these alongside their feature module
 * (e.g. user.scope.ts, webinar.scope.ts). Admin role omitted → no narrowing applied.
 *
 * Each producer receives the actor and returns the where fragment to spread into
 * the feature's findMany/findFirst/etc. call:
 *
 *   prisma.user.findMany({
 *       where: { ...userFilters, ...buildScopeWhere(actor, USER_SCOPE_RULES) },
 *   });
 */
export interface ScopeRules {
    admin?: (actor: ScopeActor) => ScopeFragment;
    curator?: (actor: ScopeActor) => ScopeFragment;
    teacher?: (actor: ScopeActor) => ScopeFragment;
}
