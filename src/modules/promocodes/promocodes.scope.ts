import type { ScopeRules } from '../../common/scoping/scope.types';

/**
 * D-20 (Phase 7 CONTEXT): Promocodes are admin-only. Curator/teacher are
 * default-denied.
 *
 * Belt-and-braces alongside the @Roles('admin') hard gate that Plan 05 will pin
 * onto every controller method. The scope rules return a contradicting where
 * fragment (`id IN ()`) so even if a non-admin actor somehow reaches a list query,
 * Prisma returns zero rows.
 *
 * admin role intentionally omitted -> buildScopeWhere() returns {} -> sees all promocodes.
 */
export const PROMOCODE_SCOPE_RULES: ScopeRules = {
    teacher: () => ({ id: { in: [] as number[] } }),
    curator: () => ({ id: { in: [] as number[] } }),
};
