import { Controller, ForbiddenException, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';
import { AdminKpiService } from './services/admin-kpi.service';
import { CuratorOverviewService } from './services/curator-overview.service';
import { TeacherOverviewService } from './services/teacher-overview.service';

/**
 * Phase 9 ANL-01..03 — analytics dashboards.
 *
 * Three GET endpoints under /admin-api/v1/admin/analytics:
 *   - /admin-kpi      — admin-only: global KPIs + 12-month revenue trend +
 *                       30-day completion trend (D-11, D-15, D-16).
 *   - /curator-overview — admin + curator: own supervised groups + member progress
 *                       (D-11). Window picker via ?window_days / ?window_all.
 *   - /teacher-overview — admin + teacher: own webinars + pending grading queue
 *                       (D-11).
 *
 * Audit posture: GET endpoints are EXEMPT from the @Audit lint
 * (scripts/ci-audit-decorator-check.cjs only enforces decoration on
 * POST/PUT/PATCH/DELETE) — so no decorator is required on these handlers.
 *
 * Caching (D-14, D-22): each service caches its computed response in Redis for
 * 5 minutes (ANALYTICS_TTL_SECONDS=300) keyed by
 * (surface, role, actor_id, filter_hash) via buildAnalyticsCacheKey. Different
 * actors have disjoint keyspaces — no cross-tenant leakage via shared cache.
 *
 * RBAC (D-19, T-09-04-03):
 *   - RolesGuard rejects non-eligible roles before the handler runs.
 *   - The as_role= query param is a UX label only; the server always scopes
 *     aggregations to the *actor's* id, never the role they're pivoting to.
 *   - Belt-and-braces ForbiddenException inside the curator/teacher handlers
 *     documents the intent + survives any future @Roles drift.
 */
@Controller('admin-api/v1/admin/analytics')
@UseGuards(JwtGuard, RolesGuard)
export class AnalyticsController {
    constructor(
        private readonly adminKpi: AdminKpiService,
        private readonly curatorOverview: CuratorOverviewService,
        private readonly teacherOverview: TeacherOverviewService,
    ) {}

    @Get('admin-kpi')
    @Roles('admin')
    public async getAdminKpi(@CurrentUser() actor: AuthenticatedRequestUser, @Query() q: AnalyticsQueryDto) {
        return this.adminKpi.compute({ id: actor.id, role_name: actor.role_name }, q);
    }

    @Get('curator-overview')
    @Roles('admin', 'curator')
    public async getCuratorOverview(@CurrentUser() actor: AuthenticatedRequestUser, @Query() q: AnalyticsQueryDto) {
        // Belt-and-braces — RolesGuard already gates this. Defensive against
        // future drift in @Roles handling. Mirrors the pattern used by
        // SalesDetailService / PaymentsDetailService (Phase 9 Plans 02-03).
        if (actor.role_name !== 'admin' && actor.role_name !== 'curator') {
            throw new ForbiddenException('analytics.curator_only');
        }
        return this.curatorOverview.compute({ id: actor.id, role_name: actor.role_name }, q);
    }

    @Get('teacher-overview')
    @Roles('admin', 'teacher')
    public async getTeacherOverview(@CurrentUser() actor: AuthenticatedRequestUser, @Query() q: AnalyticsQueryDto) {
        if (actor.role_name !== 'admin' && actor.role_name !== 'teacher') {
            throw new ForbiddenException('analytics.teacher_only');
        }
        return this.teacherOverview.compute({ id: actor.id, role_name: actor.role_name }, q);
    }
}
