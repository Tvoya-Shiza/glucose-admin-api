import type { ScopeRules } from '../../common/scoping/scope.types';

/**
 * Phase 39/40 — «Электронные книги» admin-surface RBAC data scope.
 *
 * Empty rule set: all staff manage all books (same posture as QUIZ_SCOPE_RULES /
 * TRAINER_SCOPE_RULES). Access is governed entirely by the runtime
 * @RequirePermission('ebooks.*') grants (RBAC /access/roles UI), never narrowed by
 * a per-actor Prisma predicate.
 *
 * Spread into prisma.book.findMany via buildScopeWhere(actor, EBOOK_SCOPE_RULES):
 *   admin   → omitted → buildScopeWhere returns {} → sees all books
 *   curator → omitted → {} → sees all books
 *   teacher → omitted → {} → sees all books
 */
export const EBOOK_SCOPE_RULES: ScopeRules = {
    // All keys omitted → buildScopeWhere returns {} for every staff role.
    // Content library is org-wide; visibility is gated by ebooks.* permission grants.
};
