import { Global, Module } from '@nestjs/common';
import { AudienceService } from './audience.service';
import { AudienceCacheService } from './utils/audience-cache.service';

/**
 * AudienceModule — Phase 8 Plan 02. Reusable audience resolver shared by:
 *   - Push broadcast (Plan 03)
 *   - Push schedule + cron fire-time resolution (Plan 04)
 *   - Mailings send (Plan 05)
 *
 * @Global() so consumer modules (PushModule, MailingsModule) don't have to
 * import it explicitly — the service is stateless and there's exactly one
 * instance application-wide.
 *
 * PrismaModule + RedisModule are global → no imports needed.
 */
@Global()
@Module({
    providers: [AudienceService, AudienceCacheService],
    exports: [AudienceService, AudienceCacheService],
})
export class AudienceModule {}
