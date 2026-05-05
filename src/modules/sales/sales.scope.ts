import type { ScopeRules } from '../../common/scoping/scope.types';

/**
 * SALE_SCOPE_RULES — Phase 9 D-18 + D-20 (PAY-02, PAY-03, PAY-04).
 *
 * Sales / Orders are an admin-only surface. curator + teacher default-deny via
 * `id: { in: [] }` so any list/detail/refund/export returns empty result even
 * if they bypass the @Roles('admin') gate (belt-and-braces, T-09-01-01 in plan
 * threat register).
 *
 * Refund mutation (PAY-03 / D-07) is also admin-only — covered by @Roles('admin')
 * on the controller method; this scope rule additionally guarantees that a
 * non-admin's `findFirst` call before refund returns no row, so the 3-step
 * 403-not-404 pattern from Phase 4 can still apply if Plan 03 chooses it.
 *
 * admin role intentionally omitted -> buildScopeWhere() returns {} -> sees all
 * Sale rows.
 *
 * Spread into prisma.sale.findMany({ where: { ...filters, ...buildScopeWhere(actor, SALE_SCOPE_RULES) } }).
 *
 * Verified against glucose-admin-api/prisma/schema.prisma Sale model
 * (id at line 716 — Int @id @default(autoincrement()); buyer_id at 718; refund_at at 733).
 */
export const SALE_SCOPE_RULES: ScopeRules = {
    // admin: omitted -> buildScopeWhere returns {} -> sees all sales
    curator: () => ({ id: { in: [] as number[] } }),
    teacher: () => ({ id: { in: [] as number[] } }),
};
