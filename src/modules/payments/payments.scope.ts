import type { ScopeRules } from '../../common/scoping/scope.types';

/**
 * KASPI_SCOPE_RULES — Phase 9 D-18 (PAY-01, PAY-04).
 *
 * Access to Kaspi payments is governed at runtime by @RequirePermission grants,
 * not hardcoded by role. There is no per-tenant row narrowing on payments: any
 * role granted payments.view / payments.export sees all KaspiPayment rows.
 *
 * Schema mapping note: this scope targets the `KaspiPayment` Prisma model
 * (table `kaspi_payments`); we call it "payments" in product copy / URLs.
 *
 * admin / curator / teacher roles intentionally omitted -> buildScopeWhere()
 * returns {} -> the role sees all KaspiPayment rows IF granted the permission.
 *
 * Spread into prisma.kaspiPayment.findMany({ where: { ...filters, ...buildScopeWhere(actor, KASPI_SCOPE_RULES) } }).
 *
 * Verified against glucose-admin-api/prisma/schema.prisma KaspiPayment model
 * (id at line 794 — Int @id @default(autoincrement())).
 */
export const KASPI_SCOPE_RULES: ScopeRules = {
    // admin / curator / teacher: omitted -> buildScopeWhere returns {} -> governed by @RequirePermission
};
