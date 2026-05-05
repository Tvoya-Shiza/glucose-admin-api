import { Module } from '@nestjs/common';

/**
 * PaymentsModule — Phase 9.
 *
 * Wave 1 (Plan 01): empty skeleton; AppModule registers it.
 *   KASPI_SCOPE_RULES live in payments.scope.ts (admin-only per D-18).
 *   PAYMENTS_*_PREFIX cache constants live in utils/payments-cache.ts.
 *
 * Wave 2 (Plan 02): controllers + services + DTOs land here:
 *   - PaymentsListController     GET   /admin-api/v1/admin/payments
 *   - PaymentsDetailController   GET   /admin-api/v1/admin/payments/:id
 *   - PaymentsExportController   GET   /admin-api/v1/admin/payments/export
 *
 * Every controller method carries @Roles('admin') (D-18). GET reads carry
 * @SkipAudit (D-23 — list/detail reads are not audited).
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
export class PaymentsModule {}
