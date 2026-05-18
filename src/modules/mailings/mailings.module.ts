import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { MailingsHistoryController } from './mailings-history.controller';
import { MailingsHistoryService } from './mailings-history.service';
import { MailingsSendController } from './mailings-send.controller';
import { MailingsSendService } from './mailings-send.service';
import { MailerService } from './services/mailer.service';
import { MailingsCacheService } from './utils/mailings-cache.service';

/**
 * MailingsModule — Phase 8.
 * Wave 1 (Plan 01): module skeleton + MailerService provider.
 * Wave 3 (Plan 05): send + history controllers/services landed here.
 *   - MailingsSendController + MailingsSendService — POST /send (admin-only, audited).
 *   - MailingsHistoryController + MailingsHistoryService — GET /history (admin-only).
 *   - MailingsCacheService — per-feature Redis wrapper for the history surface.
 *
 * AudienceModule (Plan 02) is @Global so AudienceService injection works
 * without an explicit import here. PrismaModule + RedisModule are also @Global.
 */
@Module({
    imports: [AccessModule],
    controllers: [MailingsSendController, MailingsHistoryController],
    providers: [MailerService, MailingsSendService, MailingsHistoryService, MailingsCacheService],
    exports: [MailerService],
})
export class MailingsModule {}
