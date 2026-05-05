import { Module } from '@nestjs/common';

/**
 * SalesModule — Phase 9.
 *
 * Wave 1 (Plan 01): empty skeleton; AppModule registers it.
 *   SALE_SCOPE_RULES live in sales.scope.ts (admin-only per D-20).
 *   SALES_*_PREFIX cache constants live in utils/sales-cache.ts.
 *
 * Wave 2 (Plan 03): controllers + services + DTOs land here:
 *   - SalesListController        GET   /admin-api/v1/admin/sales
 *   - SalesDetailController      GET   /admin-api/v1/admin/sales/:id
 *   - SalesRefundController      POST  /admin-api/v1/admin/sales/:id/refund
 *   - SalesExportController      GET   /admin-api/v1/admin/sales/export
 *
 * Every controller method carries @Roles('admin') (D-18 + D-20). The refund
 * mutation carries @Audit('sales.refund', 'sale') (D-07, D-23).
 *
 * PrismaModule + RedisModule are global (registered in AppModule), so no imports
 * are needed here.
 */
@Module({
    imports: [],
    controllers: [],
    providers: [],
    exports: [],
})
export class SalesModule {}
