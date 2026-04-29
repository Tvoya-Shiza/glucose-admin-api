import type { ScopeActor, ScopeFragment, ScopeRules } from './scope.types';

/**
 * Returns the Prisma `where` fragment narrowing data visibility for the given actor.
 *
 * Contract:
 *   - actor.role_name === 'admin'   → returns rules.admin?.(actor) ?? {}  (sees all by default)
 *   - actor.role_name === 'curator' → returns rules.curator?.(actor) ?? {}
 *   - actor.role_name === 'teacher' → returns rules.teacher?.(actor) ?? {}
 *   - any other role (e.g. 'student') → returns { id: { in: [] } } sentinel
 *     This guarantees Prisma queries return zero rows rather than accidentally
 *     leaking data when scoping rules are missing for an unexpected role.
 *
 * Per CONTEXT.md AUTH-06: Phase 2 ships skeleton + types; per-feature rules land in Phase 3+.
 */
export function buildScopeWhere(actor: ScopeActor, rules: ScopeRules): ScopeFragment {
    switch (actor.role_name) {
        case 'admin':
            return rules.admin ? rules.admin(actor) : {};
        case 'curator':
            return rules.curator ? rules.curator(actor) : {};
        case 'teacher':
            return rules.teacher ? rules.teacher(actor) : {};
        default:
            // Unknown role — fail closed by injecting an impossible predicate.
            // Prisma will return empty results rather than letting the query bypass scoping.
            // Note: every Prisma model in this schema has an `id` PK; if a model uses a
            // different PK, the per-feature scope file (Phase 3+) should add its own guard.
            return { id: { in: [] as number[] } };
    }
}

// Example call site (documentation only — not executed):
//   const ADMIN_ONLY_RULES: ScopeRules = { /* admin: omitted = sees all */ };
//   const fragment = buildScopeWhere(actor, ADMIN_ONLY_RULES);
//   prisma.user.findMany({ where: { ...filters, ...fragment } });
