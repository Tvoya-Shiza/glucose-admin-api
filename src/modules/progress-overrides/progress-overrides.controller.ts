import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    Param,
    ParseIntPipe,
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
import { BulkGrantOverridesDto } from './dto/bulk-grant-overrides.dto';
import { BulkRevokeOverridesDto } from './dto/bulk-revoke-overrides.dto';
import { ListOverridesQueryDto } from './dto/list-overrides-query.dto';
import { ProgressOverridesService } from './progress-overrides.service';

/**
 * Phase 19 / Feature B1 — content-unlock overrides REST surface.
 *
 * Path: /admin-api/v1/admin/courses/:courseId/overrides
 *
 *   GET    /        — list overrides for one (target, course) — view permission
 *   POST   /        — bulk grant — manage permission, admin-only, audited
 *   DELETE /        — bulk revoke (body) — manage permission, admin-only, audited
 *
 * The list endpoint is open to curator+admin so reviewers can verify a target
 * (user or group) without being able to mutate. Mutations stay admin-only.
 */
@Controller('admin-api/v1/admin/courses/:courseId/overrides')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class ProgressOverridesController {
    constructor(private readonly svc: ProgressOverridesService) {}

    @Get()
    @Roles('admin', 'curator')
    @RequirePermission('progress_overrides.view')
    public async list(
        @Param('courseId', ParseIntPipe) courseId: number,
        @Query() query: ListOverridesQueryDto,
    ) {
        return this.svc.list(courseId, query);
    }

    @Post()
    @Roles('admin')
    @RequirePermission('progress_overrides.manage')
    @Audit('progress_overrides.grant', 'course_content_override')
    public async bulkGrant(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('courseId', ParseIntPipe) courseId: number,
        @Body() dto: BulkGrantOverridesDto,
    ) {
        const data = await this.svc.bulkGrant(
            { id: actor.id, role_name: actor.role_name },
            courseId,
            dto,
        );
        return apiResponse(1, 'ok', 'progress_overrides.granted', data);
    }

    @Delete()
    @HttpCode(200)
    @Roles('admin')
    @RequirePermission('progress_overrides.manage')
    @Audit('progress_overrides.revoke', 'course_content_override')
    public async bulkRevoke(
        @Param('courseId', ParseIntPipe) courseId: number,
        @Body() dto: BulkRevokeOverridesDto,
    ) {
        const data = await this.svc.bulkRevoke(courseId, dto);
        return apiResponse(1, 'ok', 'progress_overrides.revoked', data);
    }
}
