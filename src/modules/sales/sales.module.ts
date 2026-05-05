import { Module } from '@nestjs/common';
import { SalesDetailController } from './sales-detail.controller';
import { SalesDetailService } from './sales-detail.service';
import { SalesListController } from './sales-list.controller';
import { SalesListService } from './sales-list.service';
import { SalesRefundController } from './sales-refund.controller';
import { SalesRefundService } from './sales-refund.service';

/**
 * SalesModule — Phase 9.
 *
 * Wave 1 (Plan 01): empty skeleton; AppModule registers it.
 *   SALE_SCOPE_RULES live in sales.scope.ts (admin-only per D-20).
 *   SALES_*_PREFIX cache constants live in utils/sales-cache.ts.
 *
 * Wave 2 (Plan 03): controllers + services + DTOs land here:
 *   - SalesListController        GET   /admin-api/v1/admin/sales        (Task 1)
 *   - SalesDetailController      GET   /admin-api/v1/admin/sales/:id    (Task 1)
 *   - SalesRefundController      POST  /admin-api/v1/admin/sales/:id/refund  (Task 2)
 *   - SalesExportController      POST  /admin-api/v1/admin/sales/export (Task 3)
 *
 * Every controller method carries @Roles('admin') (D-18 + D-20). The refund
 * mutation carries @Audit('sales.refund', 'sale') (D-07, D-23). The export
 * mutation carries @Audit('sales.export', 'sale') + @Throttle 5/15min (D-09).
 *
 * PrismaModule + RedisModule are global (registered in AppModule), so no imports
 * are needed here.
 */
@Module({
    imports: [],
    controllers: [SalesListController, SalesDetailController, SalesRefundController],
    providers: [SalesListService, SalesDetailService, SalesRefundService],
    exports: [SalesListService, SalesDetailService, SalesRefundService],
})
export class SalesModule {}
