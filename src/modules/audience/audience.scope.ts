import type { ScopeRules } from '../../common/scoping/scope.types';

/**
 * AUDIENCE_SCOPE_RULES — Phase 8 Plan 02 belt-and-braces narrowing.
 *
 * The audience-preview controller is `@Roles('admin')` (D-19), so curator/teacher
 * receive 403 BEFORE AudienceService.resolve() is reached — but Plans 03/04/05
 * also call AudienceService.resolve() at broadcast/schedule-fire/mailing-send time
 * with the actor identity, and we want defense-in-depth even if a future plan
 * accidentally exposes a curator/teacher path. Mirrors USER_SCOPE_RULES so a
 * curator's audience cannot include users outside their supervised groups, and
 * a teacher's audience cannot include users outside their course-students.
 *
 *   admin   → no narrowing (sees all users)
 *   curator → only users in groups they supervise
 *               User.group_users -> GroupUser.group -> Group.supervisor_id = actor.id
 *   teacher → only users who bought a webinar where actor is the teacher
 *               User.sales_as_buyer -> Sale.webinar -> Webinar.teacher_id = actor.id
 *
 * Spread into prisma.user.findMany({ where: { AND: [..., { ...narrowing }] } })
 * so the AND-combined filter list does NOT eat the narrowing fragment.
 *
 * Relation names verified 2026-05-04 against schema.prisma:
 *   - User.group_users at line 266
 *   - User.sales_as_buyer at line 279
 *   - Group.supervisor_id at line 315
 *   - Sale.webinar relation -> Webinar.teacher_id (line 252 backref)
 */
export const AUDIENCE_SCOPE_RULES: ScopeRules = {
    // admin: omitted -> buildScopeWhere returns {} -> sees all users
    curator: (actor) => ({
        group_users: { some: { group: { supervisor_id: actor.id } } },
    }),
    teacher: (actor) => ({
        sales_as_buyer: { some: { webinar: { teacher_id: actor.id } } },
    }),
};
