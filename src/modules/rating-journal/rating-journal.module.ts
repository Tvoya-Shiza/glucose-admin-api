import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { RatingJournalCellsController } from './rating-journal-cells.controller';
import { RatingJournalColumnsController } from './rating-journal-columns.controller';
import { RatingJournalController } from './rating-journal.controller';
import { RatingJournalCellsService } from './services/rating-journal-cells.service';
import { RatingJournalColumnsService } from './services/rating-journal-columns.service';
import { RatingJournalCreditAdapter } from './services/rating-journal-credit.adapter';
import { RatingJournalService } from './services/rating-journal.service';
import { RatingJournalSyncService } from './services/rating-journal-sync.service';
import { RatingJournalWriterService } from './services/rating-journal-writer.service';

/**
 * RatingJournalModule — «Рейтинг-журнал» (Block 1, Phase 35).
 *
 * Controllers:
 *   RatingJournalController        — grid + list + create + sync (/rating-journal)
 *   RatingJournalColumnsController — custom/attendance column CRUD (/rating-journal/columns)
 *   RatingJournalCellsController   — cell autosave + edit-log (/rating-journal/cells)
 *
 * Exports RatingJournalCreditAdapter so CreditsModule can bind CREDIT_JOURNAL_PORT
 * to it (replacing CreditJournalStub) — the «Зачёт» → journal wire (Block 2 gap).
 *
 * AccessModule is required (PermissionGuard needs PermissionsService).
 * PrismaModule is global in AppModule.
 */
@Module({
    imports: [AccessModule],
    controllers: [RatingJournalController, RatingJournalColumnsController, RatingJournalCellsController],
    providers: [
        RatingJournalService,
        RatingJournalColumnsService,
        RatingJournalCellsService,
        RatingJournalSyncService,
        RatingJournalWriterService,
        RatingJournalCreditAdapter,
    ],
    exports: [RatingJournalCreditAdapter],
})
export class RatingJournalModule {}
