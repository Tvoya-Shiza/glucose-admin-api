import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { Audit } from '../../common/audit/audit.decorator';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { GradeSubmissionDto } from './dto/grade-submission.dto';
import { ListSubmissionsDto } from './dto/list-submissions.dto';
import { ReplyMessageDto } from './dto/reply-message.dto';
import { AssignmentsSubmissionsService } from './assignments-submissions.service';

/**
 * Submissions + grading endpoints.
 *
 * Routes (mounted under /admin-api/v1/admin/assignments/:assignmentId/submissions):
 *   GET    /                         — paginated list of WebinarAssignmentHistory rows
 *   GET    /:historyId               — submission detail (thread of messages)
 *   POST   /:historyId/grade         — set status + grade + optional inline comment
 *   POST   /:historyId/messages      — curator/admin posts a thread reply
 *
 * RBAC:
 *   - View: admin (all) / curator (their groups) / teacher (own webinars).
 *   - Grade + reply: admin (all) / curator (their groups). Teachers may NOT grade
 *     by default — assignments.grade isn't seeded for the teacher role.
 */
@Controller('admin-api/v1/admin/assignments/:assignmentId/submissions')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class AssignmentsSubmissionsController {
    constructor(private readonly svc: AssignmentsSubmissionsService) {}

    @Get()
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('assignments.submissions_view')
    public async list(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('assignmentId', ParseIntPipe) assignmentId: number,
        @Query() query: ListSubmissionsDto,
    ) {
        return this.svc.listForAssignment({ id: actor.id, role_name: actor.role_name }, assignmentId, query);
    }

    @Get(':historyId')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('assignments.submissions_view')
    public async detail(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('assignmentId', ParseIntPipe) assignmentId: number,
        @Param('historyId', ParseIntPipe) historyId: number,
    ) {
        return this.svc.detail({ id: actor.id, role_name: actor.role_name }, assignmentId, historyId);
    }

    @Post(':historyId/grade')
    @Roles('admin', 'curator')
    @RequirePermission('assignments.grade')
    @Audit('assignments.submission.grade', 'submission')
    public async grade(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('assignmentId', ParseIntPipe) assignmentId: number,
        @Param('historyId', ParseIntPipe) historyId: number,
        @Body() dto: GradeSubmissionDto,
    ) {
        return this.svc.grade({ id: actor.id, role_name: actor.role_name }, assignmentId, historyId, dto);
    }

    @Post(':historyId/messages')
    @Roles('admin', 'curator')
    @RequirePermission('assignments.grade')
    @Audit('assignments.submission.reply', 'submission')
    public async reply(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('assignmentId', ParseIntPipe) assignmentId: number,
        @Param('historyId', ParseIntPipe) historyId: number,
        @Body() dto: ReplyMessageDto,
    ) {
        return this.svc.reply({ id: actor.id, role_name: actor.role_name }, assignmentId, historyId, dto);
    }
}
