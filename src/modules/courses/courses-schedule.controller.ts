import {
    BadRequestException,
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    ParseIntPipe,
    Patch,
    Post,
    Query,
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
import { ScheduleDto, ScheduleListQueryDto } from './dto/schedule.dto';
import { CoursesScheduleService } from './courses-schedule.service';

/**
 * CRS-08 — per-stream scheduling controller (Plan 06).
 *
 * Routes (under /admin-api/v1/admin/courses/:id/schedules):
 *   GET    /                           — list schedules for this course (?group_id= optional filter)
 *   POST   /                           — create one schedule row
 *   PATCH  /:scheduleId                — update one schedule row
 *   DELETE /:scheduleId                — delete one schedule row
 *
 * scheduleId is a STRING on the wire (BigInt @db.UnsignedBigInt on schema). The
 * controller parses to BigInt at the service boundary; the service writes/reads
 * BigInt; the global BigIntStringInterceptor serializes BigInt fields back to
 * string on the response.
 *
 * RBAC: admin / teacher (CONTEXT D-19 — curators excluded; they don't author
 * courses and the schedule editor is owner-only). Service layer enforces 3-step
 * assertCourseScope (existence -> teacher gate -> proceed) — foreign-teacher
 * direct access yields 403, soft-deleted course yields 404.
 *
 * Audit: 3 audited handlers (create / update / delete). GET is exempt.
 */
@Controller('admin-api/v1/admin/courses/:id/schedules')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class CoursesScheduleController {
    constructor(private readonly svc: CoursesScheduleService) {}

    @Get()
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('courses.view')
    public async list(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) courseId: number,
        @Query() query: ScheduleListQueryDto,
    ) {
        return this.svc.list({ id: actor.id, role_name: actor.role_name }, courseId, query);
    }

    @Post()
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('courses.edit')
    @Audit('courses.schedule.create', 'webinar_chapter_schedule')
    @HttpCode(HttpStatus.OK)
    public async create(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) courseId: number,
        @Body() dto: ScheduleDto,
    ) {
        return this.svc.create({ id: actor.id, role_name: actor.role_name }, courseId, dto);
    }

    @Patch(':scheduleId')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('courses.edit')
    @Audit('courses.schedule.update', 'webinar_chapter_schedule')
    public async update(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) courseId: number,
        @Param('scheduleId') scheduleIdStr: string,
        @Body() dto: ScheduleDto,
    ) {
        return this.svc.update(
            { id: actor.id, role_name: actor.role_name },
            courseId,
            this.parseScheduleId(scheduleIdStr),
            dto,
        );
    }

    @Delete(':scheduleId')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('courses.edit')
    @Audit('courses.schedule.delete', 'webinar_chapter_schedule')
    @HttpCode(HttpStatus.OK)
    public async delete(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) courseId: number,
        @Param('scheduleId') scheduleIdStr: string,
    ) {
        return this.svc.delete(
            { id: actor.id, role_name: actor.role_name },
            courseId,
            this.parseScheduleId(scheduleIdStr),
        );
    }

    /**
     * Parse a path param string to BigInt. Rejects non-numeric / out-of-range
     * inputs with 400 before they reach Prisma (which would otherwise throw a
     * less-readable runtime error).
     */
    private parseScheduleId(input: string): bigint {
        if (typeof input !== 'string' || !/^\d+$/.test(input)) {
            throw new BadRequestException('schedule.invalid_id');
        }
        try {
            return BigInt(input);
        } catch {
            throw new BadRequestException('schedule.invalid_id');
        }
    }
}
