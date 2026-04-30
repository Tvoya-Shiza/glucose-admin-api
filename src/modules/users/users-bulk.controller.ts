import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Audit } from '../../common/audit/audit.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { BulkProvisionDto } from './dto/bulk-provision.dto';
import { UsersBulkService } from './users-bulk.service';

/**
 * USR-04 + USR-05 — Plan 05: bulk-provision endpoint.
 *
 * Single endpoint POST /admin-api/v1/admin/users/bulk-provision serves both dry-run
 * preview and commit (D-13 — `mode` discriminates in the body). Audit fires for every
 * call — even dry-run attempts are auditable signals (someone tried to grant 600 grants;
 * even uncommitted, the attempt is meaningful).
 *
 * Path matches the convention set by Plans 02-04 (`admin-api/v1/admin/users` — admin-api
 * is not setGlobalPrefix'd; the prefix is embedded per controller).
 *
 * RBAC: admin / curator / teacher. Curator + teacher additionally narrowed by
 * USER_SCOPE_RULES (in service); teacher additionally narrowed by webinar.teacher_id.
 *
 * Audit: `@Audit('users.bulkProvision', 'sale')` — `ci:audit-required` enforces.
 */
@Controller('admin-api/v1/admin/users')
@UseGuards(JwtGuard, RolesGuard)
export class UsersBulkController {
    constructor(private readonly bulkService: UsersBulkService) {}

    @Post('bulk-provision')
    @Roles('admin', 'curator', 'teacher')
    @Audit('users.bulkProvision', 'sale')
    public async provision(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Body() dto: BulkProvisionDto,
    ) {
        return this.bulkService.provision({ id: actor.id, role_name: actor.role_name }, dto);
    }
}
