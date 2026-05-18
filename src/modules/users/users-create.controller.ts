import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Audit } from '../../common/audit/audit.decorator';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { CreateUserDto } from './dto/create-user.dto';
import { UsersCreateService } from './users-create.service';

/**
 * POST /admin-api/v1/admin/users — admin-only single-user creation surface.
 *
 * Path matches the convention set by `users-list.controller.ts` (`@Controller('admin-api/v1/admin/users')`
 * — admin-api is not setGlobalPrefix'd; the prefix is embedded per controller).
 *
 * RBAC: admin only — creating curators / teachers grants high privilege; even
 * admin self-creating a student is a sensitive operation that must be auditable.
 *
 * Audit: `@Audit('users.create', 'user')` — `ci:audit-required` enforces the decorator
 * on every non-GET handler.
 */
@Controller('admin-api/v1/admin/users')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class UsersCreateController {
    constructor(private readonly createService: UsersCreateService) {}

    @Post()
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('users.create')
    @Audit('users.create', 'user')
    public async create(@CurrentUser() actor: AuthenticatedRequestUser, @Body() dto: CreateUserDto) {
        return this.createService.create({ id: actor.id, role_name: actor.role_name }, dto);
    }
}
