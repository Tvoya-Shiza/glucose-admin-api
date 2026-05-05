import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditReadService } from './audit-read.service';

/**
 * AuditModule — Phase 10 Plan 01 (foundations).
 *
 * Surfaces the AdminAuditLog table written since Phase 2 (audit interceptor + NDJSON
 * fallback). Controller exposes three GET endpoints under /admin-api/v1/admin/audit:
 *   - /log       — paginated list with filters (AUD-01, AUD-02, AUD-03)
 *   - /actions   — distinct actions for combobox source (AUD-03)
 *   - /entities  — distinct entities for combobox source (AUD-03)
 *
 * PrismaModule is @Global (Phase 0 Plan 02), so PrismaService injects without re-importing.
 * No additional providers required — service is self-contained.
 */
@Module({
    controllers: [AuditController],
    providers: [AuditReadService],
})
export class AuditModule {}
