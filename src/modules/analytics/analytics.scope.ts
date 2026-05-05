import type { ScopeRules } from '../../common/scoping/scope.types';

/**
 * ANALYTICS_SCOPE_RULES — Phase 9 D-19 + D-22.
 *
 * Analytics dashboards apply role-specific narrowing inside each endpoint
 * (admin sees all; curator narrows to supervised groups via Group.supervisor_id;
 * teacher narrows to teacher_id-owned Webinars). This rules object is
 * intentionally permissive — Plan 04 services do their own actor.id scoping
 * per query because the shape differs per dashboard:
 *
 *   - admin-kpi:         no narrowing (admin-only by @Roles + as_role= pivot)
 *   - curator-overview:  WHERE Group.supervisor_id = actor.id
 *   - teacher-overview:  WHERE Webinar.teacher_id = actor.id
 *
 * Kept here for symmetry with other surfaces and future-proofing if a generic
 * analytics scope helper emerges. Calling buildScopeWhere(actor, ANALYTICS_SCOPE_RULES)
 * returns {} for all 3 staff roles (no narrowing) — the per-endpoint service
 * layer is the actual gate.
 *
 * Verified against glucose-admin-api/prisma/schema.prisma:
 *   Group.supervisor_id (line ~302), Webinar.teacher_id (line 819).
 */
export const ANALYTICS_SCOPE_RULES: ScopeRules = {
    // admin/curator/teacher: omitted -> buildScopeWhere returns {} -> per-endpoint
    // narrowing in Plan 04 services.
};
