import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    Param,
    ParseIntPipe,
    Patch,
    Post,
    Query,
    UseGuards,
} from '@nestjs/common';
import { Audit } from '../../common/audit/audit.decorator';
import { apiResponse } from '../../common/utils/api-response';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { CourseAccessService } from './course-access.service';
import { ExtendAccessDto } from './dto/extend-access.dto';
import { GrantGroupAccessDto } from './dto/grant-group-access.dto';
import { GrantUserAccessDto } from './dto/grant-user-access.dto';
import { ListCourseAccessorsQueryDto } from './dto/list-course-accessors-query.dto';
import { ListGroupGrantsQueryDto } from './dto/list-group-grants-query.dto';

/**
 * Phase 18 — Course access REST surface.
 *
 * One controller (not many) — splits the routes across three URL bases:
 *   - /users/:userId/course-access            POST     (Feature C primary use; PR-5 also)
 *   - /groups/:groupId/course-access          POST/GET (Feature A)
 *   - /sales/:saleId/access                   PATCH/DELETE (works on both direct + group sales)
 *
 * Convention vs existing modules: SalesRefundController also routes under
 * /admin-api/v1/admin/sales/:id/refund — placing extend/revoke at /:saleId/access
 * keeps the path namespaced ("access" sub-resource) and away from /refund which
 * has reason-required semantics for paid sales.
 *
 * Permission codes (new in PR-2):
 *   course_access.{view,grant,revoke,extend}
 *
 * RBAC:
 *   - grant/revoke/extend  : admin only (manual access management is operator-only).
 *   - list (GET)           : admin + curator (curator sees their groups; service is
 *                            scope-less for now since group detail endpoint already
 *                            gates the curator from seeing groups they don't supervise).
 *
 * Audit: every mutation carries @Audit(...) so changes are reviewable in /audit.
 */
@Controller('admin-api/v1/admin')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class CourseAccessController {
    constructor(private readonly svc: CourseAccessService) {}

    @Post('users/:userId/course-access')
    @Roles('admin')
    @RequirePermission('course_access.grant')
    @Audit('course_access.user.grant', 'sale')
    public async grantUserAccess(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('userId', ParseIntPipe) userId: number,
        @Body() dto: GrantUserAccessDto,
    ) {
        const data = await this.svc.grantUserAccess(
            { id: actor.id, role_name: actor.role_name },
            userId,
            dto,
        );
        return apiResponse(1, 'ok', 'course_access.granted', data);
    }

    @Post('groups/:groupId/course-access')
    @Roles('admin')
    @RequirePermission('course_access.grant')
    @Audit('course_access.group.grant', 'sale')
    public async grantGroupAccess(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('groupId', ParseIntPipe) groupId: number,
        @Body() dto: GrantGroupAccessDto,
    ) {
        const data = await this.svc.grantGroupAccess(
            { id: actor.id, role_name: actor.role_name },
            groupId,
            dto,
        );
        return apiResponse(1, 'ok', 'course_access.granted', data);
    }

    @Get('groups/:groupId/course-access')
    @Roles('admin', 'curator')
    @RequirePermission('course_access.view')
    public async listGroupGrants(
        @Param('groupId', ParseIntPipe) groupId: number,
        @Query() query: ListGroupGrantsQueryDto,
    ) {
        return this.svc.listGroupGrants(groupId, query);
    }

    @Patch('sales/:saleId/access')
    @Roles('admin')
    @RequirePermission('course_access.extend')
    @Audit('course_access.extend', 'sale')
    public async extendAccess(
        @Param('saleId', ParseIntPipe) saleId: number,
        @Body() dto: ExtendAccessDto,
    ) {
        const data = await this.svc.extendAccess(saleId, dto);
        return apiResponse(1, 'ok', 'course_access.extended', data);
    }

    @Delete('sales/:saleId/access')
    @HttpCode(200)
    @Roles('admin')
    @RequirePermission('course_access.revoke')
    @Audit('course_access.revoke', 'sale')
    public async revokeAccess(@Param('saleId', ParseIntPipe) saleId: number) {
        const data = await this.svc.revokeAccess(saleId);
        return apiResponse(1, 'ok', 'course_access.revoked', data);
    }

    // ------------------------------------------------------------------------
    // Feature C — Course → Accessors tab
    // ------------------------------------------------------------------------

    @Get('courses/:courseId/accessors')
    @Roles('admin', 'curator')
    @RequirePermission('course_access.view')
    public async listCourseAccessors(
        @Param('courseId', ParseIntPipe) courseId: number,
        @Query() query: ListCourseAccessorsQueryDto,
    ) {
        return this.svc.listCourseAccessors(courseId, query);
    }

    @Get('courses/:courseId/accessors/summary')
    @Roles('admin', 'curator')
    @RequirePermission('course_access.view')
    public async courseAccessorsSummary(@Param('courseId', ParseIntPipe) courseId: number) {
        return this.svc.courseAccessorsSummary(courseId);
    }
}
