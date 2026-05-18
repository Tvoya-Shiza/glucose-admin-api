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
import { BlogsBulkService } from './blogs-bulk.service';

/**
 * BLG-04 — POST /admin-api/v1/admin/blogs/bulk-status (Plan 04 Task 1).
 *
 * Single endpoint serves both dry-run preview and commit (D-13 — `mode` discriminates).
 * Audit fires on every call (even uncommitted dry-runs are auditable signals).
 *
 * RBAC: admin-only.
 *
 * Returns the raw BulkStatusResult shape (NOT wrapped in apiResponse) — admin-client
 * useDryRunPreview hook + DryRunDialog consume it directly, mirroring Phase 3 Plan 05
 * and Phase 7 Plans 02/03.
 */
@Controller('admin-api/v1/admin/blogs')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class BlogsBulkController {
    constructor(private readonly svc: BlogsBulkService) {}

    @Post('bulk-status')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('blogs.publish')
    @Audit('blogs.bulkStatus', 'blog')
    @HttpCode(200)
    public async bulkStatus(@CurrentUser() actor: AuthenticatedRequestUser, @Body() dto: BulkStatusDto) {
        return this.svc.bulkStatus({ id: actor.id, role_name: actor.role_name }, dto);
    }
}
