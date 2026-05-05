import { Module } from '@nestjs/common';
import { MailingsSendController } from './mailings-send.controller';
import { MailingsSendService } from './mailings-send.service';
import { MailerService } from './services/mailer.service';

/**
 * MailingsModule — Phase 8.
 * Wave 1 (Plan 01): module skeleton + MailerService provider.
 * Wave 3 (Plan 05): MailingsSendController + MailingsSendService landed here.
 *
 * AudienceModule (Plan 02) is @Global so AudienceService injection works
 * without an explicit import here. PrismaModule is also @Global.
 */
@Module({
    imports: [],
    controllers: [MailingsSendController],
    providers: [MailerService, MailingsSendService],
    exports: [MailerService],
})
export class MailingsModule {}
