import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { CreditsResultsService } from './credits-results.service';
import { ListCreditResultsDto } from './dto/list-credit-results.dto';

/**
 * Cross-credit results page (item 9). Its own prefix (/credit-results) so it never
 * competes with the /credits/:id detail routes. Read-only → no @Audit.
 */
@Controller('admin-api/v1/admin/credit-results')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class CreditsResultsController {
    constructor(private readonly svc: CreditsResultsService) {}

    @Get()
    @Roles('admin', 'curator')
    @RequirePermission('credits.results_view')
    public async list(@CurrentUser() actor: AuthenticatedRequestUser, @Query() query: ListCreditResultsDto) {
        return this.svc.listAll({ id: actor.id, role_name: actor.role_name }, query);
    }
}
