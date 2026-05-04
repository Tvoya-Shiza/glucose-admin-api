import { Module } from '@nestjs/common';
import { MailerService } from './services/mailer.service';

/**
 * MailingsModule — Phase 8.
 * Wave 1 (this plan): module skeleton + MailerService provider.
 * Wave 3 (Plan 05): send + history controllers/services land here.
 */
@Module({
    imports: [],
    controllers: [],
    providers: [MailerService],
    exports: [MailerService],
})
export class MailingsModule {}
