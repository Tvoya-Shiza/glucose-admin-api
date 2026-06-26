import { Controller, Get, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { QuizzesDetailService } from './quizzes-detail.service';

/**
 * QZ-01 + QZ-08 — GET /admin-api/v1/admin/quizzes/:id (Plan 04).
 *
 * RBAC: runtime-driven. admin / curator / teacher all hit the route, gated by
 * @RequirePermission('quizzes.view'). Quizzes are global content with no per-tenant
 * ownership, so any actor that passes both guards (role allowed + permission granted)
 * gets 200. There is no role-based 403 here anymore (historically curators were
 * default-denied per D-21; that is now governed by the runtime grant).
 *
 * 404 is reserved for "quiz genuinely does not exist".
 *
 * Audit posture: GET endpoints are exempt from the @Audit lint — no decorator needed.
 */
@Controller('admin-api/v1/admin/quizzes')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class QuizzesDetailController {
    constructor(private readonly svc: QuizzesDetailService) {}

    @Get(':id')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('quizzes.view')
    public async getDetail(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
    ) {
        return this.svc.getDetail({ id: actor.id, role_name: actor.role_name }, id);
    }
}
