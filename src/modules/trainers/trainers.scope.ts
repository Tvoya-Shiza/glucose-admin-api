import type { ScopeRules } from '../../common/scoping/scope.types';

/**
 * Phase 38 — «Тренажёр» admin surface RBAC data scope.
 *
 * Two rule sets, mirroring quizzes.scope.ts (the trainer domain scopes two
 * separate Prisma models with different semantics):
 *
 *   TRAINER_SCOPE_RULES        → Quizzes kind='trainer' (write surface — author/edit a trainer)
 *   TRAINER_RESULT_SCOPE_RULES → TrainerAttempt (read surface — view attempt rows)
 *
 * Spread into prisma.<model>.findMany via buildScopeWhere(actor, RULES). Admin
 * key is omitted in both → buildScopeWhere returns {} → admin sees all rows.
 */

/**
 * Trainer edit-surface rules.
 *
 *   admin   → omitted → buildScopeWhere returns {} → sees all trainers
 *   teacher → omitted → same posture as QUIZ_SCOPE_RULES (D-21: staff edit any
 *             quiz-domain content; access governed by @RequirePermission('trainers.*'))
 *   curator → omitted → {} → sees all trainers; access is governed by the runtime
 *             @RequirePermission('trainers.*') grants, not hardcoded by role.
 *             Results stay narrowed to their groups (see TRAINER_RESULT_SCOPE_RULES).
 */
export const TRAINER_SCOPE_RULES: ScopeRules = {
    // admin: omitted -> buildScopeWhere returns {} -> sees all trainers
    // teacher: omitted -> staff edit ANY trainer (mirrors QUIZ_SCOPE_RULES)
    // curator: omitted -> {} -> sees all trainers. Access is governed by the runtime
    //          @RequirePermission('trainers.*') grants (RBAC UI), not hardcoded by role.
};

/**
 * Trainer-attempt read-surface rules.
 *
 *   admin   → omitted → sees all attempts
 *   curator → narrows to attempts whose user.group_users[*].group.supervisor_id === actor.id
 *             (Group.supervisor_id is the curator FK on Group — same predicate as
 *             QUIZ_RESULT_SCOPE_RULES.curator)
 *   teacher → narrows to attempts on trainers linked (via trainer_courses) to webinars
 *             where Webinar.teacher_id === actor.id.
 *             ★ PLACEHOLDER ★ — the rule below emits an impossible predicate
 *             (`{ id: { in: [] } }`) which DENIES every row. The call site
 *             (utils/trainer-results-where.ts) MUST replace it with a TWO-STEP lookup:
 *
 *                 const ownWebinars = await prisma.webinar.findMany({
 *                     where: { teacher_id: actor.id },
 *                     select: { id: true },
 *                 });
 *                 // zero webinars → short-circuit (default-deny);
 *                 // else narrow quiz.trainer_courses.some.webinar_id IN (ownWebinars)
 *
 *             We CANNOT inline the lookup here because ScopeRules producers are sync and
 *             receive only `{ id, role_name }` (no PrismaService) — same constraint that
 *             produced the QUIZ_RESULT_SCOPE_RULES teacher placeholder (T-06-02).
 *
 * Relation truths (verified against glucose-admin-api/prisma/schema.prisma):
 *   - TrainerAttempt.user: User (relation "TrainerAttemptUser")
 *   - TrainerAttempt.quiz: Quizzes (relation "TrainerAttempts") — FK enforced, never orphan
 *   - Quizzes.trainer_courses: TrainerCourse[] → Webinar (relation "WebinarTrainerCourses")
 *   - User.group_users: GroupUser[] → Group.supervisor_id (curator FK, Phase 4)
 */
export const TRAINER_RESULT_SCOPE_RULES: ScopeRules = {
    // admin: omitted -> sees all attempts
    curator: (actor) => ({
        user: {
            group_users: {
                some: {
                    group: { supervisor_id: actor.id },
                },
            },
        },
    }),
    // ★ PLACEHOLDER — fail-closed; utils/trainer-results-where.ts replaces at call site ★
    teacher: () => ({ id: { in: [] as number[] } }),
};
