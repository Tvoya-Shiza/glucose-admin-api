import { Module } from '@nestjs/common';
import { PushFcmService } from './services/push-fcm.service';

/**
 * PushModule — Phase 8.
 * Wave 1 (this plan): module skeleton + PushFcmService provider.
 * Wave 3 (Plan 03): broadcast + history controllers/services land here.
 * Wave 4 (Plan 04): schedule + cron controllers/services land here.
 *
 * PrismaModule + RedisModule are global → no imports needed.
 * ConfigModule is global (registered in AppModule).
 */
@Module({
    imports: [],
    controllers: [],
    providers: [PushFcmService],
    exports: [PushFcmService],
})
export class PushModule {}
