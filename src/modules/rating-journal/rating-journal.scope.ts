import type { ScopeRules } from '../../common/scoping/scope.types';

/**
 * «Рейтинг-журнал» data-visibility rules (mirrors credits.scope.ts, Phase 35).
 *
 *   RATING_JOURNAL_SCOPE_RULES → RatingJournal rows (list/grid/create)
 *   RATING_JOURNAL_COLUMN_SCOPE_RULES → RatingJournalColumn rows (column CRUD)
 *   RATING_JOURNAL_CELL_SCOPE_RULES → RatingJournalCell rows (cell edit / history)
 *
 *   admin   → omitted → buildScopeWhere returns {} → sees all
 *   curator → narrows to journals of the groups the actor supervises
 *   teacher → FAIL-CLOSED (impossible predicate) — teachers have no journal surface (TZ 1.2)
 *
 * Spread the fragment LAST into every Prisma `where` — forgetting it leaks
 * cross-curator data.
 */
export const RATING_JOURNAL_SCOPE_RULES: ScopeRules = {
    curator: (actor) => ({ group: { supervisor_id: actor.id } }),
    teacher: () => ({ id: { in: [] as bigint[] } }),
};

export const RATING_JOURNAL_COLUMN_SCOPE_RULES: ScopeRules = {
    curator: (actor) => ({ journal: { group: { supervisor_id: actor.id } } }),
    teacher: () => ({ id: { in: [] as bigint[] } }),
};

export const RATING_JOURNAL_CELL_SCOPE_RULES: ScopeRules = {
    curator: (actor) => ({ column: { journal: { group: { supervisor_id: actor.id } } } }),
    teacher: () => ({ id: { in: [] as bigint[] } }),
};
