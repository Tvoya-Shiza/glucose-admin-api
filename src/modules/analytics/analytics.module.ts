import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AdminKpiService } from './services/admin-kpi.service';
import { CuratorOverviewService } from './services/curator-overview.service';
import { TeacherOverviewService } from './services/teacher-overview.service';

/**
 * AnalyticsModule — Phase 9 (Wave 2 Plan 04).
 *
 * Wires the 3 dashboard endpoints (ANL-01..03):
 *   - GET /admin-api/v1/admin/analytics/admin-kpi
 *   - GET /admin-api/v1/admin/analytics/curator-overview
 *   - GET /admin-api/v1/admin/analytics/teacher-overview
 *
 * RBAC narrowing happens inline in each service per D-19 because the where-shape
 * differs per dashboard:
 *   - admin-kpi:        no narrowing (admin-only by @Roles + as_role pivot)
 *   - curator-overview: WHERE Group.supervisor_id = actor.id
 *   - teacher-overview: WHERE Webinar.teacher_id = actor.id +
 *                       WHERE WebinarAssignmentHistory.instructor_id = actor.id
 *
 * Reads are exempt from @Audit lint (D-23). 5-minute cache per
 * (role, actor_id, filter_hash) tuple via buildAnalyticsCacheKey() (D-22).
 *
 * PrismaModule + RedisModule are global (registered in AppModule), so no imports
 * are needed here.
 */
@Module({
    imports: [],
    controllers: [AnalyticsController],
    providers: [AdminKpiService, CuratorOverviewService, TeacherOverviewService],
    exports: [AdminKpiService, CuratorOverviewService, TeacherOverviewService],
})
export class AnalyticsModule {}
