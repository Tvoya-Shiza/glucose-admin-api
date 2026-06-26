import type { ScopeRules } from '../../common/scoping/scope.types';

/**
 * MAILING_SCOPE_RULES — Phase 8 D-19.
 *
 * Mailings access is runtime-RBAC-driven (governed by @RequirePermission grants),
 * not hardcoded by role. curator/teacher are omitted here -> buildScopeWhere
 * returns {} -> the role sees all rows IF granted the permission.
 */
export const MAILING_SCOPE_RULES: ScopeRules = {
    // curator: omitted -> {} -> governed by @RequirePermission grant.
    // teacher: omitted -> {} -> governed by @RequirePermission grant.
};
