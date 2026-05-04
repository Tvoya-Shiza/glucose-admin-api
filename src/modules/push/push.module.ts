import { Module } from '@nestjs/common';
import { PushAudienceController } from './push-audience.controller';
import { PushBroadcastController } from './push-broadcast.controller';
import { PushBroadcastService } from './push-broadcast.service';
import { PushFcmService } from './services/push-fcm.service';

/**
 * PushModule — Phase 8.
 * Wave 1 (Plan 01): module skeleton + PushFcmService provider.
 * Wave 2 (Plan 02): PushAudienceController landed here — POST /audience-preview.
 *   AudienceService comes from @Global() AudienceModule, so no imports needed.
 * Wave 3 (Plan 03): broadcast + history controllers/services landed here.
 *   PushBroadcastService is exported so Plan 04 cron can call .broadcast() with
 *   triggerType='admin.scheduled' and a scheduled_push_id-derived broadcastId.
 * Wave 4 (Plan 04): schedule + cron controllers/services land here.
 *
 * PrismaModule + RedisModule + AudienceModule are global → no imports needed.
 * ConfigModule is global (registered in AppModule).
 */
@Module({
    imports: [],
    controllers: [PushAudienceController, PushBroadcastController],
    providers: [PushFcmService, PushBroadcastService],
    exports: [PushFcmService, PushBroadcastService],
})
export class PushModule {}
