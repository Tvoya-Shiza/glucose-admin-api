import type { ScopeRules } from '../../common/scoping/scope.types';

/**
 * KASPI_SCOPE_RULES — Phase 9 D-18 (PAY-01, PAY-04).
 *
 * Kaspi payments are an admin-only surface. curator + teacher default-deny via
 * `id: { in: [] }` so any list/detail/export returns empty result even if they
 * bypass the @Roles('admin') gate (belt-and-braces, T-09-01-01 in plan threat
 * register).
 *
 * Schema mapping note: this scope targets the `KaspiPayment` Prisma model
 * (table `kaspi_payments`); we call it "payments" in product copy / URLs.
 *
 * admin role intentionally omitted -> buildScopeWhere() returns {} -> sees all
 * KaspiPayment rows.
 *
 * Spread into prisma.kaspiPayment.findMany({ where: { ...filters, ...buildScopeWhere(actor, KASPI_SCOPE_RULES) } }).
 *
 * Verified against glucose-admin-api/prisma/schema.prisma KaspiPayment model
 * (id at line 794 — Int @id @default(autoincrement())).
 */
export const KASPI_SCOPE_RULES: ScopeRules = {
    // admin: omitted -> buildScopeWhere returns {} -> sees all kaspi payments
    curator: () => ({ id: { in: [] as number[] } }),
    teacher: () => ({ id: { in: [] as number[] } }),
};
