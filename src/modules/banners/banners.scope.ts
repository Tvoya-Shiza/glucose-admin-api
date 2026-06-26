import type { ScopeRules } from '../../common/scoping/scope.types';

/**
 * Advertisement banner visibility scope rules.
 *
 * Access is runtime-RBAC-driven: governed by the @RequirePermission grants on the
 * banner controllers, not hardcoded by role. No role narrows banner rows by ownership,
 * so every admitted role that holds the relevant permission sees all banners.
 *
 * Schema mapping note: this scope rule targets the `Advertisement` Prisma model
 * (table `advertisements`); we call it "banners" in product copy / URLs.
 *
 * admin role omitted -> buildScopeWhere() returns {} -> governed by @RequirePermission.
 * teacher role omitted -> buildScopeWhere() returns {} -> governed by @RequirePermission.
 * curator role omitted -> buildScopeWhere() returns {} -> governed by @RequirePermission.
 */
export const BANNER_SCOPE_RULES: ScopeRules = {};
