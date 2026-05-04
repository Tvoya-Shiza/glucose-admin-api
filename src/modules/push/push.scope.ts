import type { ScopeRules } from '../../common/scoping/scope.types';

/**
 * PUSH_SCOPE_RULES — Phase 8 D-19.
 *
 * Applied to the PUSH HISTORY query (Plan 03 list-history endpoint):
 *   admin   → omitted → buildScopeWhere returns {} → sees all PushNotificationLog rows
 *   curator → narrows to log rows whose user_id is a member of a group the curator supervises
 *   teacher → narrows to log rows whose user_id is enrolled in a course the teacher owns
 *
 * Send actions (broadcast, schedule) are guarded by `@Roles('admin')` directly;
 * scope helpers are not used for the send path.
 *
 * NOTE: curator + teacher narrowing uses a subquery via Prisma `where: { user: { ... } }`
 * to avoid a separate audience-resolution round trip. The exact shape is verified by
 * Plan 03 against the User model relation graph at write-time.
 */
export const PUSH_SCOPE_RULES: ScopeRules = {
    curator: (actor) => ({
        user: {
            group_users: { some: { group: { supervisor_id: actor.id } } },
        },
    }),
    teacher: (actor) => ({
        // Teacher = students enrolled in courses they own. Plan 03 may refine the relation
        // chain (Sale.webinar_id → Webinar.teacher_id) once verified against schema.
        user: {
            sales_as_buyer: { some: { webinar: { teacher_id: actor.id } } },
        },
    }),
};
