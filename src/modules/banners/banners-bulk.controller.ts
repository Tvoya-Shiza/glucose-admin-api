import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Audit } from '../../common/audit/audit.decorator';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { BulkStatusDto } from './dto/bulk-status.dto';
import { BannersBulkService } from './banners-bulk.service';

/**
 * BAN-03 — POST /admin-api/v1/admin/banners/bulk-status (Plan 03 Task 1).
 *
 * Single endpoint serves both dry-run preview and commit (D-08 — `mode` discriminates).
 * Audit fires on every call (even uncommitted dry-runs are auditable signals).
 *
 * RBAC: admin-only.
 *
 * Returns the raw BulkStatusResult shape (NOT wrapped in apiResponse) — admin-client
 * useDryRunPreview hook + DryRunDialog consume it directly, mirroring the Phase 3
 * Plan 05 bulk-provision endpoint.
 */
@Controller('admin-api/v1/admin/banners')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class BannersBulkController {
    constructor(private readonly svc: BannersBulkService) {}

    @Post('bulk-status')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('banners.publish')
    @Audit('banners.bulkStatus', 'advertisement')
    @HttpCode(200)
    public async bulkStatus(@CurrentUser() actor: AuthenticatedRequestUser, @Body() dto: BulkStatusDto) {
        return this.svc.bulkStatus({ id: actor.id, role_name: actor.role_name }, dto);
    }
}
