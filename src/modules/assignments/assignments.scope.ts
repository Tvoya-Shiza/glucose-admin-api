import type { ScopeRules } from '../../common/scoping/scope.types';

/**
 * Assignment read/edit-surface rules (matches QUIZ_SCOPE_RULES posture).
 *
 *   admin   → omitted → buildScopeWhere returns {} → sees all assignments
 *   teacher → omitted → teacher edits ANY assignment (matches D-21 posture for quizzes)
 *   curator → omitted → {} → governed by @RequirePermission; a granted curator sees
 *             all assignments on the read surface. Curators are not in @Roles for the
 *             write endpoints, so this does not grant authoring rights.
 */
export const ASSIGNMENT_SCOPE_RULES: ScopeRules = {};

/**
 * Submission read-surface rules.
 *
 *   admin   → omitted → sees all submissions
 *   curator → narrows to submissions whose student is in a group the curator supervises
 *             (User.group_users[*].group.supervisor_id === actor.id), mirroring
 *             QUIZ_RESULT_SCOPE_RULES Phase 6.
 *   teacher → PLACEHOLDER returning empty set — Plan 02 of the submissions service must
 *             override at the call site with a two-step lookup over Webinar.teacher_id
 *             (same pattern as QUIZ_RESULT_SCOPE_RULES; the producer is sync so we
 *             can't query Prisma here).
 */
export const ASSIGNMENT_SUBMISSION_SCOPE_RULES: ScopeRules = {
    curator: (actor) => ({
        student: {
            group_users: {
                some: {
                    group: { supervisor_id: actor.id },
                },
            },
        },
    }),
    teacher: () => ({ assignment_id: { in: [] as number[] } }),
};
