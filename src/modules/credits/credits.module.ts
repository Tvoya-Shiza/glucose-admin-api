import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { CreditQuestionsController } from './credit-questions.controller';
import { CreditQuestionsService } from './credit-questions.service';
import { CreditQuestionsImportService } from './credit-questions-import.service';
import { CreditTopicsController } from './credit-topics.controller';
import { CreditTopicsService } from './credit-topics.service';
import { CreditsConductController } from './credits-conduct.controller';
import { CreditsConductService } from './credits-conduct.service';
import { CreditsDetailController } from './credits-detail.controller';
import { CreditsDetailService } from './credits-detail.service';
import { CreditsExpiryCronService } from './credits-expiry.cron';
import { CreditsLaunchController } from './credits-launch.controller';
import { CreditsLaunchService } from './credits-launch.service';
import { CreditsListController } from './credits-list.controller';
import { CreditsListService } from './credits-list.service';
import { CreditsMutationsController } from './credits-mutations.controller';
import { CreditsMutationsService } from './credits-mutations.service';
import { CreditsResultsController } from './credits-results.controller';
import { CreditsResultsService } from './credits-results.service';
import { CreditsSettingsController } from './credits-settings.controller';
import { CreditsSettingsService } from './credits-settings.service';
import { CREDIT_JOURNAL_PORT } from './journal/credit-journal.port';
import { RatingJournalModule } from '../rating-journal/rating-journal.module';
import { RatingJournalCreditAdapter } from '../rating-journal/services/rating-journal-credit.adapter';

/**
 * CreditsModule — «Зачёт» oral credit surface (Phase 34).
 *
 * Controllers (registration order matters where static segments compete with
 * ':id' peers on the same prefix):
 *   CreditsListController      — GET '' + GET 'calendar' (static — MUST precede ':id')
 *   CreditsLaunchController    — ':id/launches' wizard + launches tab
 *   CreditsDetailController    — ':id' / ':id/history' / ':id/eligible-students'
 *   CreditsMutationsController — POST/PATCH/DELETE credits
 *   CreditTopicsController     — topic tree CRUD   (/credit-topics)
 *   CreditQuestionsController  — bank CRUD + availability (/credit-questions)
 *   CreditsConductController   — conduct console   (/credit-sessions)
 *   CreditsSettingsController  — result texts      (/credit-settings)
 *
 * CREDIT_JOURNAL_PORT is bound to RatingJournalCreditAdapter (Phase 35) — a
 * finalized session's result lands in the «Зачет» column of the rating journal.
 * The stub (CreditJournalStub) is retired.
 *
 * PrismaModule / RedisModule / CronLockModule are global in AppModule.
 */
@Module({
    imports: [AccessModule, RatingJournalModule],
    controllers: [
        CreditsListController,
        CreditsResultsController,
        CreditsLaunchController,
        CreditsDetailController,
        CreditsMutationsController,
        CreditTopicsController,
        CreditQuestionsController,
        CreditsConductController,
        CreditsSettingsController,
    ],
    providers: [
        CreditsListService,
        CreditsResultsService,
        CreditsDetailService,
        CreditsMutationsService,
        CreditsLaunchService,
        CreditTopicsService,
        CreditQuestionsService,
        CreditQuestionsImportService,
        CreditsConductService,
        CreditsSettingsService,
        CreditsExpiryCronService,
        { provide: CREDIT_JOURNAL_PORT, useExisting: RatingJournalCreditAdapter },
    ],
    exports: [],
})
export class CreditsModule {}
