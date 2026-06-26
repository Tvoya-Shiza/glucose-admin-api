import type { ScopeRules } from '../../common/scoping/scope.types';

/**
 * D-20 (Phase 7 CONTEXT): Story access is runtime-RBAC-driven, governed by the
 * @RequirePermission grants on each controller method (stories.view / .create /
 * .edit / .delete / .publish) — not hardcoded by role.
 *
 * All roles are intentionally omitted here -> buildScopeWhere() returns {} for them
 * -> a role sees all stories IF it has been granted the relevant permission.
 * Unknown roles (e.g. student) still fail closed via the default branch inside
 * common/scoping/scope.helper.ts.
 */
export const STORY_SCOPE_RULES: ScopeRules = {
    // teacher omitted -> {} -> governed by @RequirePermission.
    // curator omitted -> {} -> governed by @RequirePermission.
};
