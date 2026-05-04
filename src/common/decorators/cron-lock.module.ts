import { Global, Module } from '@nestjs/common';
import { CronLockService } from './cron-lock.decorator';

/**
 * Phase 8 Plan 04 — admin-side CronLockModule.
 *
 * Vendored from glucose-api/src/common/decorators/cron-lock.module.ts (Phase 1 Plan 04).
 * Global so cron-host services do not need an explicit import; they only inject
 * `cronLock: CronLockService` (public readonly) and apply @CronLock(name, ttlMs).
 */
@Global()
@Module({
    providers: [CronLockService],
    exports: [CronLockService],
})
export class CronLockModule {}
