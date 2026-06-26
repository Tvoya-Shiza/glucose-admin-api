import type { ScopeRules } from '../../common/scoping/scope.types';

/**
 * D-20 (Phase 7 CONTEXT): Promocode access is runtime-RBAC-driven — governed by the
 * grantable @RequirePermission('promocodes.*') codes on the controllers, not by role.
 *
 * No role narrows promocodes by row: every admitted role omitted here ->
 * buildScopeWhere() returns {} -> sees all promocodes IF granted the permission.
 *   - admin   -> omitted -> {} -> governed by @RequirePermission
 *   - teacher -> omitted -> {} -> governed by @RequirePermission
 *   - curator -> omitted -> {} -> governed by @RequirePermission
 */
export const PROMOCODE_SCOPE_RULES: ScopeRules = {};
