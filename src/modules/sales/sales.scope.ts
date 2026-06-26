import type { ScopeRules } from '../../common/scoping/scope.types';

/**
 * SALE_SCOPE_RULES — Phase 9 D-18 + D-20 (PAY-02, PAY-03, PAY-04).
 *
 * Access to Sales / Orders is governed at runtime by @RequirePermission grants
 * (sales.view, sales.export, payments.refund) on the controller methods — NOT
 * hardcoded by role. Any admitted role that holds the grant sees all Sale rows;
 * roles without the grant are rejected by PermissionGuard.
 *
 * Spread into prisma.sale.findMany({ where: { ...filters, ...buildScopeWhere(actor, SALE_SCOPE_RULES) } }).
 *
 * Verified against glucose-admin-api/prisma/schema.prisma Sale model
 * (id at line 716 — Int @id @default(autoincrement()); buyer_id at 718; refund_at at 733).
 */
export const SALE_SCOPE_RULES: ScopeRules = {
    // admin: omitted -> buildScopeWhere returns {} -> sees all sales
    // curator: omitted -> {} -> governed by @RequirePermission
    // teacher: omitted -> {} -> governed by @RequirePermission
};
