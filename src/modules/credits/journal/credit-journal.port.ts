import type { CreditJournalEntry } from '@shared/credits';

/**
 * Rating-journal port (contract decision 3). The journal itself does not exist
 * yet — CreditsConductService talks to this interface only, so the eventual
 * real adapter is a provider swap in credits.module.ts, not a service rewrite.
 *
 * Invoked EXACTLY ONCE per finalized session (finished | expired), AFTER the
 * finalize transaction commits, inside try/catch — a journal failure must never
 * fail or roll back the finalize.
 */
export const CREDIT_JOURNAL_PORT = Symbol('CREDIT_JOURNAL_PORT');

export interface CreditJournalPort {
    record(entry: CreditJournalEntry): Promise<void>;
}
