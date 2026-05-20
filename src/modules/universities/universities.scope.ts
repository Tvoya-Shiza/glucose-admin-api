import type { ScopeRules } from '../../common/scoping/scope.types';

/**
 * Phase 17 — Universities & Specialties catalog is admin/curator readable and
 * admin-only writable. Belt-and-braces alongside `@Roles(...)` hard gate on
 * controllers; if @Roles is ever bypassed, the scope rules collapse non-admin
 * read queries to `id IN ()` so Prisma returns empty results.
 *
 * Admin role intentionally omitted -> {} -> sees all.
 * Curator gets {} explicitly because we DO want curators to read (RBAC grants `*.view`).
 * Teacher / unknown -> empty result sentinel.
 */
export const UNIVERSITY_SCOPE_RULES: ScopeRules = {
    curator: () => ({}),
    teacher: () => ({ id: { in: [] as number[] } }),
};
