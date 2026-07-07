import { Injectable } from '@nestjs/common';
import type { CreditJournalEntry } from '@shared/credits';
import type { CreditJournalPort } from '../../credits/journal/credit-journal.port';
import { RatingJournalWriterService } from './rating-journal-writer.service';

/**
 * Real CreditJournalPort adapter (Phase 35) — replaces CreditJournalStub.
 *
 * CreditsConductService.runPostFinalizeEffects() calls record() exactly once per
 * finalized session, AFTER the finalize tx commits, inside try/catch. A crash
 * between commit and this call re-invokes with the same session — record() stays
 * idempotent because recordCreditResult recomputes the authoritative value from
 * the credit sessions and writeAutoCell no-ops on an unchanged (value, session).
 */
@Injectable()
export class RatingJournalCreditAdapter implements CreditJournalPort {
    constructor(private readonly writer: RatingJournalWriterService) {}

    public async record(entry: CreditJournalEntry): Promise<void> {
        await this.writer.recordCreditResult(entry);
    }
}
