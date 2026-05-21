import { Controller, Get, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CoursesProgressService } from './courses-progress.service';
import { ProgressReportQueryDto } from './dto/progress-report-query.dto';

/**
 * Phase 19 / Feature B2 — read-only progress report.
 *
 * GET /admin-api/v1/admin/courses/:courseId/progress?target_kind=user|group&target_id=N
 *
 * RBAC: admin / curator / teacher (anyone who can already see the course can
 * see the report). Mutations live in the separate progress-overrides module
 * (Feature B1, PR-6).
 */
@Controller('admin-api/v1/admin/courses/:courseId/progress')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class CoursesProgressController {
    constructor(private readonly svc: CoursesProgressService) {}

    @Get()
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('courses.view')
    public async report(
        @Param('courseId', ParseIntPipe) courseId: number,
        @Query() query: ProgressReportQueryDto,
    ) {
        return this.svc.getReport(courseId, query);
    }
}
