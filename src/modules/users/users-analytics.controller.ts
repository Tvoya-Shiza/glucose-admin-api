import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { UsersAnalyticsQueryDto } from './dto/users-analytics.dto';
import { UsersAnalyticsService } from './users-analytics.service';

/**
 * GET /admin-api/v1/admin/users/analytics — read-only KPI surface for the users
 * page. GET endpoints are exempt from the @Audit lint. Scope (curator/teacher
 * narrowing) is re-applied in the service via USER_SCOPE_RULES.
 */
@Controller('admin-api/v1/admin/users')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class UsersAnalyticsController {
    constructor(private readonly service: UsersAnalyticsService) {}

    @Get('analytics')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('users.view')
    public async getAnalytics(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Query() query: UsersAnalyticsQueryDto,
    ) {
        return this.service.compute({ id: actor.id, role_name: actor.role_name }, query);
    }
}
