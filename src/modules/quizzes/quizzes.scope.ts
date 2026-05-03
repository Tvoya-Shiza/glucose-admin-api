import type { ScopeRules } from '../../common/scoping/scope.types';

/**
 * QZ-01..09 RBAC data scope (CONTEXT D-21..D-23).
 *
 * Two distinct rule sets in this file because the Phase 6 surface scopes two
 * separate Prisma models with very different rules:
 *
 *   QUIZ_SCOPE_RULES         → Quizzes (write surface — author/edit a quiz)
 *   QUIZ_RESULT_SCOPE_RULES  → QuizResult (read surface — view attempt rows)
 *
 * Spread into prisma.<model>.findMany via buildScopeWhere(actor, RULES). Admin
 * key is omitted in both → buildScopeWhere returns {} → admin sees all rows.
 */

/**
 * Quiz edit-surface rules — D-21.
 *
 *   admin   → omitted → buildScopeWhere returns {} → sees all quizzes
 *   teacher → omitted → per D-21 user spec, "teacher can edit any quiz/test" — VERY PERMISSIVE
 *             (intentional; the planner verified this with the user. Plans 02/04/05/06 enforce
 *             RBAC at the @Roles decorator only — no scope narrowing applied)
 *   curator → default-deny ({ id: { in: [] } }) — curators have NO author/edit access.
 *             They CAN view results filtered to their groups (see QUIZ_RESULT_SCOPE_RULES).
 *
 * Spread example (Plan 02+):
 *   prisma.quizzes.findMany({
 *       where: { ...filters, ...buildScopeWhere(actor, QUIZ_SCOPE_RULES) },
 *   });
 */
export const QUIZ_SCOPE_RULES: ScopeRules = {
    // admin: omitted -> buildScopeWhere returns {} -> sees all quizzes
    // teacher: omitted -> per D-21, teacher edits ANY quiz/test
    curator: () => ({ id: { in: [] as number[] } }),
};

/**
 * Quiz-result read-surface rules — D-22 + D-23.
 *
 *   admin   → omitted → sees all results
 *   curator → narrows to results whose user.group_users[*].group.supervisor_id === actor.id
 *             (Group.supervisor_id is the curator FK on Group — verified against admin-api schema)
 *   teacher → narrows to results whose webinar_id is in the set of webinars where
 *             Webinar.teacher_id === actor.id.
 *             ★ PLACEHOLDER ★ — the rule below emits `{ webinar_id: { in: [] as number[] } }`
 *             which DENIES every row. Plan 07's results service MUST replace this at the call
 *             site with a TWO-STEP lookup:
 *
 *                 const ownWebinars = await prisma.webinar.findMany({
 *                     where: { teacher_id: actor.id },
 *                     select: { id: true },
 *                 });
 *                 const teacherWhere = { webinar_id: { in: ownWebinars.map((w) => w.id) } };
 *                 // then merge teacherWhere INTO the where clause manually for teacher actors,
 *                 // bypassing buildScopeWhere(actor, QUIZ_RESULT_SCOPE_RULES) for teachers.
 *
 *             We CANNOT inline the lookup here because ScopeRules producers are sync and
 *             receive only `{ id, role_name }` (no PrismaService). T-06-02 in this plan's
 *             threat model flags the placeholder; Plan 07's must_haves block requires a
 *             test-mode verification of cross-tenant denial.
 *
 * Relation truths (verified against glucose-admin-api/prisma/schema.prisma):
 *   - QuizResult.webinar_id: Int? (line 623)
 *   - User.group_users: GroupUser[] (relation "GroupUsers", line 258)
 *   - GroupUser.group: Group (relation "GroupMembers", line 322)
 *   - Group.supervisor_id: curator FK (Phase 4)
 *
 * Spread example (Plan 07 — for ADMIN + CURATOR only; teacher uses the manual override above):
 *   prisma.quizResult.findMany({
 *       where: { ...filters, ...buildScopeWhere(actor, QUIZ_RESULT_SCOPE_RULES) },
 *   });
 */
export const QUIZ_RESULT_SCOPE_RULES: ScopeRules = {
    // admin: omitted -> sees all results
    curator: (actor) => ({
        user: {
            group_users: {
                some: {
                    group: { supervisor_id: actor.id },
                },
            },
        },
    }),
    // ★ PLACEHOLDER — Plan 07 MUST replace at call site (see header comment above) ★
    teacher: () => ({ webinar_id: { in: [] as number[] } }),
};
