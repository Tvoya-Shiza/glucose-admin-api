import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Audit } from '../../common/audit/audit.decorator';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { ImportUsersDto } from './dto/import-users.dto';
import { UsersImportService } from './users-import.service';

/**
 * USR-06 — Plan 06: CSV import endpoint.
 *
 * Single endpoint POST /admin-api/v1/admin/users/import serves both dry-run preview
 * and commit (D-16 — `mode` discriminates in the body). Audit fires for every call;
 * even uncommitted dry-run attempts are auditable signal — same-endpoint pattern as
 * Plan 05 keeps `@Audit` for both modes.
 *
 * Path matches the convention set by Plans 02-05 — `admin-api/v1/admin/users` with
 * the prefix embedded per controller (admin-api is not setGlobalPrefix'd).
 *
 * RBAC: ADMIN-ONLY (T-03-50). Curator/teacher cannot mass-import users — operator
 * trust required for arbitrary write of role_name + status fields.
 *
 * Audit: `@Audit('users.import', 'user')` — `ci:audit-required` enforces.
 */
@Controller('admin-api/v1/admin/users')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class UsersImportController {
    constructor(private readonly importService: UsersImportService) {}

    @Post('import')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('users.import')
    @Audit('users.import', 'user')
    public async import(@CurrentUser() actor: AuthenticatedRequestUser, @Body() dto: ImportUsersDto) {
        return this.importService.import({ id: actor.id, role_name: actor.role_name }, dto);
    }
}
