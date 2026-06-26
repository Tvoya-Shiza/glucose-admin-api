import type { ScopeRules } from '../../common/scoping/scope.types';

/**
 * Phase 17 — Universities & Specialties catalog. Access is runtime-RBAC-driven:
 * any admitted role that holds the relevant `@RequirePermission` grant reads the
 * full catalog. The scope rules add no role-based row narrowing here.
 *
 * Admin role intentionally omitted -> {} -> sees all.
 * Curator gets {} explicitly because we DO want curators to read (RBAC grants `*.view`).
 * Teacher omitted -> {} -> governed by @RequirePermission (sees all rows IF granted).
 */
export const UNIVERSITY_SCOPE_RULES: ScopeRules = {
    curator: () => ({}),
    // teacher omitted -> {} -> governed by @RequirePermission
};
