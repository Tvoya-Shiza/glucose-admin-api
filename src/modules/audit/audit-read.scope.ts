import type { ScopeRules } from '../../common/scoping/scope.types';

/**
 * Audit-read scope (D-02 + D-24 from CONTEXT).
 *
 * Admin: full visibility — no narrowing applied (sees every audit row across the platform).
 * Curator: narrowed to actor_id = self.id — sees only audit rows they themselves produced.
 * Teacher: narrowed to actor_id = self.id — same posture as curator.
 *
 * No "audit-of-my-resources" model in v1.0 — only "actions I personally took". The wider
 * "actions on resources I own" view is a future polish (would need entity-specific RBAC join
 * logic per phase, not worth shipping with the milestone).
 *
 * IMPORTANT (T-10-03): callers MUST spread this LAST in the where composition so curator/
 * teacher cannot widen visibility via a `?actor_id=N` query param — the scope-applied
 * `actor_id` overrides any user-supplied value:
 *
 *   const where = { ...filterWhere, ...buildScopeWhere(actor, AUDIT_READ_SCOPE_RULES) };
 *
 * Admin's scope returns `{}` so they can filter freely (intended).
 */
export const AUDIT_READ_SCOPE_RULES: ScopeRules = {
    // admin: omitted -> buildScopeWhere returns {} -> sees all audit rows
    curator: (actor) => ({ actor_id: actor.id }),
    teacher: (actor) => ({ actor_id: actor.id }),
};
