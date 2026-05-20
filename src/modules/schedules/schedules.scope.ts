import type { ScopeRules } from '../../common/scoping/scope.types';

/**
 * Lesson-schedule visibility rules.
 *
 *   admin   → omitted → buildScopeWhere returns {} → sees all schedules
 *   curator → narrows to schedules where the actor is the curator
 *   teacher → same as curator: narrows to schedules where the actor is the curator
 *
 * Rationale: per stakeholder, only the curator/teacher actually responsible for a
 * schedule should see it. Permission gating (`schedules.view`) decides WHO reaches
 * the route at all; this scope decides WHICH rows they see.
 *
 * Per-curator visibility relies on the create-side guard in schedules-mutations.service.ts
 * forcing `curator_id = actor.id` for non-admin actors — keeping ownership and visibility
 * in lock-step without an extra "schedule_viewers" table.
 */
export const SCHEDULE_SCOPE_RULES: ScopeRules = {
    curator: (actor) => ({ curator_id: actor.id }),
    teacher: (actor) => ({ curator_id: actor.id }),
};
