import { Module } from '@nestjs/common';
import { PaymentsDetailController } from './payments-detail.controller';
import { PaymentsDetailService } from './payments-detail.service';
import { PaymentsExportController } from './payments-export.controller';
import { PaymentsExportService } from './payments-export.service';
import { PaymentsListController } from './payments-list.controller';
import { PaymentsListService } from './payments-list.service';

/**
 * PaymentsModule — Phase 9.
 *
 * Wave 1 (Plan 01): empty skeleton; AppModule registers it.
 *   KASPI_SCOPE_RULES live in payments.scope.ts (admin-only per D-18).
 *   PAYMENTS_*_PREFIX cache constants live in utils/payments-cache.ts.
 *
 * Wave 2 (Plan 02): list + detail land here:
 *   - PaymentsListController     GET   /admin-api/v1/admin/payments
 *   - PaymentsDetailController   GET   /admin-api/v1/admin/payments/:id
 *
 * Wave 2 (Plan 02 Task 2): export controller + service added below:
 *   - PaymentsExportController   POST  /admin-api/v1/admin/payments/export
 *
 * Every controller method carries @Roles('admin') (D-18). GET reads carry no
 * @Audit (D-23 — list/detail reads are not audited; lint exempts GET handlers).
 *
 * PrismaModule + RedisModule are global (registered in AppModule), so no imports
 * are needed here.
 */
@Module({
    imports: [],
    controllers: [PaymentsListController, PaymentsDetailController, PaymentsExportController],
    providers: [PaymentsListService, PaymentsDetailService, PaymentsExportService],
    exports: [PaymentsListService, PaymentsDetailService, PaymentsExportService],
})
export class PaymentsModule {}
