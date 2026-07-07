import { Injectable, Logger } from '@nestjs/common';
import type { CreditJournalEntry } from '@shared/credits';
import type { CreditJournalPort } from './credit-journal.port';

/**
 * No-op journal adapter (contract decision 3): logs one structured line per
 * finalized session and does nothing else.
 *
 * TODO(rating-journal): when the real rating journal ships, replace this stub
 * with an adapter that persists the entry. record() MUST stay idempotent by
 * session_id — finalize is idempotent via an updateMany status predicate, but a
 * crash between commit and record() means the caller may retry the same
 * session, so the adapter has to upsert/dedupe on session_id rather than
 * blindly insert.
 */
@Injectable()
export class CreditJournalStub implements CreditJournalPort {
    private readonly logger = new Logger(CreditJournalStub.name);

    public async record(entry: CreditJournalEntry): Promise<void> {
        this.logger.log(`credit-journal ${JSON.stringify(entry)}`);
    }
}
