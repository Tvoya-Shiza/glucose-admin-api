import { Module } from '@nestjs/common';

/**
 * AnalyticsModule — Phase 9.
 *
 * Wave 1 (Plan 01): empty skeleton; AppModule registers it.
 *   ANALYTICS_SCOPE_RULES live in analytics.scope.ts (intentionally permissive —
 *   per-endpoint actor narrowing happens inline in Plan 04 services per D-19).
 *   ANALYTICS_*_PREFIX cache constants + buildAnalyticsCacheKey() live in
 *   utils/analytics-cache.ts (D-22).
 *
 * Wave 2 (Plan 04): controllers + services + DTOs land here:
 *   - AnalyticsAdminKpiController       GET /admin-api/v1/admin/analytics/admin-kpi
 *   - AnalyticsCuratorOverviewController GET /admin-api/v1/admin/analytics/curator-overview
 *   - AnalyticsTeacherOverviewController GET /admin-api/v1/admin/analytics/teacher-overview
 *
 * Each endpoint inspects actor.role_name and applies its own narrowing:
 *   - admin-kpi:        @Roles('admin') (with as_role= pivot for support — D-19)
 *   - curator-overview: @Roles('admin', 'curator')
 *   - teacher-overview: @Roles('admin', 'teacher')
 *
 * Reads carry @SkipAudit (D-23). 5-minute cache per (role, actor_id, filter_hash)
 * tuple via buildAnalyticsCacheKey() (D-22).
 *
 * PrismaModule + RedisModule are global (registered in AppModule), so no imports
 * are needed here.
 */
@Module({
    imports: [],
    controllers: [],
    providers: [],
    exports: [],
})
export class AnalyticsModule {}
