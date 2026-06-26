import { Controller, Get, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UniversitiesAnalyticsService } from './universities-analytics.service';

/**
 * GET /admin-api/v1/admin/universities/analytics — single read-only payload
 * with counts and "top N" lists across universities / specialties /
 * admission_stats. RBAC: anyone with `universities.view`.
 */
@Controller('admin-api/v1/admin/universities')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class UniversitiesAnalyticsController {
    constructor(private readonly svc: UniversitiesAnalyticsService) {}

    @Get('analytics')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('universities.view')
    public async analytics() {
        return this.svc.build();
    }
}
