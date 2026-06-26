import {
    Body,
    Controller,
    Delete,
    HttpCode,
    HttpStatus,
    Param,
    ParseIntPipe,
    Patch,
    Post,
    UseGuards,
} from '@nestjs/common';
import { Audit } from '../../common/audit/audit.decorator';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { CreateCourseDto } from './dto/create-course.dto';
import { UpdateCourseDto } from './dto/update-course.dto';
import { CoursesMutationsService } from './courses-mutations.service';

/**
 * CRS-01 + CRS-07 — admin/teacher course mutations (Plan 02 task 2).
 *
 * Routes:
 *   POST   /admin-api/v1/admin/courses          -> create        (admin / teacher)
 *   PATCH  /admin-api/v1/admin/courses/:id      -> update fields (admin / teacher own)
 *   DELETE /admin-api/v1/admin/courses/:id      -> soft-delete   (admin / teacher own)
 *
 * RBAC:
 *   - @Roles('admin', 'curator', 'teacher') + a grantable @RequirePermission per handler;
 *     access is governed at runtime by the permission grant (no blanket role denial).
 *   - Teachers may create courses where teacher_id === self.id (T-05-10 service-side gate).
 *   - Teachers may PATCH/DELETE only their own courses (T-05-11 3-step assertScope).
 *
 * Audit (T-05-15): every handler decorated. The CI lint
 * `scripts/ci-audit-decorator-check.cjs` enforces this on non-GET endpoints.
 */
@Controller('admin-api/v1/admin/courses')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class CoursesMutationsController {
    constructor(private readonly svc: CoursesMutationsService) {}

    @Post()
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('courses.create')
    @Audit('courses.create', 'webinar')
    public async create(@CurrentUser() actor: AuthenticatedRequestUser, @Body() dto: CreateCourseDto) {
        return this.svc.create({ id: actor.id, role_name: actor.role_name }, dto);
    }

    @Patch(':id')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('courses.edit')
    @Audit('courses.update', 'webinar')
    public async update(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: UpdateCourseDto,
    ) {
        return this.svc.update({ id: actor.id, role_name: actor.role_name }, id, dto);
    }

    @Delete(':id')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('courses.delete')
    @Audit('courses.delete', 'webinar')
    @HttpCode(HttpStatus.OK)
    public async remove(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
    ) {
        return this.svc.softDelete({ id: actor.id, role_name: actor.role_name }, id);
    }
}
