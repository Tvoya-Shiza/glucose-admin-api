import type { ScopeRules } from '../../common/scoping/scope.types';

/**
 * Blog visibility is runtime-RBAC-driven (governed by @RequirePermission grants on the
 * controllers), not hardcoded by role.
 *
 * admin/teacher/curator roles are intentionally omitted -> buildScopeWhere() returns {}
 * -> each role sees all blogs IF granted the relevant blogs.* permission. No blanket
 * row-narrowing here.
 */
export const BLOG_SCOPE_RULES: ScopeRules = {};
