import { Controller, Get, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { UsersQuizzesService } from './users-quizzes.service';

/**
 * GET /admin-api/v1/admin/users/:id/quizzes — quiz access + result feed for the
 * detail page's "Tests" tab. Scope checked inside the service (404 on miss).
 */
@Controller('admin-api/v1/admin/users')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class UsersQuizzesController {
    constructor(private readonly service: UsersQuizzesService) {}

    @Get(':id/quizzes')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('users.view')
    public async list(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
    ) {
        return this.service.list({ id: actor.id, role_name: actor.role_name }, id);
    }
}
