import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { ListCoursesDto } from './dto/list-courses.dto';
import { CoursesListService } from './courses-list.service';

/**
 * CRS-01 + CRS-02 + CRS-07 (list half) — GET /admin-api/v1/admin/courses.
 *
 * Returns the raw CourseListResponseDto shape (NOT wrapped in apiResponse) per
 * glucose-admin-api/CLAUDE.md "List endpoints (Phase 3+) return `{ rows, total, ... }`
 * directly — TanStack Table on the admin-client consumes the raw shape."
 *
 * Audit posture: GET endpoints are exempt from the @Audit lint — no decorator needed.
 *
 * RBAC: admin / curator / teacher all hit the route. WEBINAR_SCOPE_RULES narrows visibility:
 *   - admin   -> all courses
 *   - teacher -> own courses (teacher_id === actor.id)
 *   - curator -> default-deny (id: { in: [] }) -> empty result
 *
 * Curators are kept on the route (not @Roles('admin','teacher')) so that any future
 * admin-flow that wants to surface a 'no courses' state for curators continues to render
 * with a real 200 response. AdminNav already hides the link for curators per Plan 01.
 */
@Controller('admin-api/v1/admin/courses')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class CoursesListController {
    constructor(private readonly listService: CoursesListService) {}

    @Get()
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('courses.view')
    public async list(@CurrentUser() actor: AuthenticatedRequestUser, @Query() query: ListCoursesDto) {
        return this.listService.list({ id: actor.id, role_name: actor.role_name }, query);
    }
}
