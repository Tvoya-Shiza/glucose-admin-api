import { Body, Controller, Param, ParseIntPipe, Patch, UseGuards } from '@nestjs/common';
import { apiResponse } from '../../common/utils/api-response';
import { Audit } from '../../common/audit/audit.decorator';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { ChangeBlogAuthorDto } from './dto/change-author.dto';
import { BlogsAuthorService } from './blogs-author.service';

/**
 * BLG-03 — admin-only blog author reassignment (Plan 04 / D-11).
 *
 * Single endpoint: `PATCH /admin-api/v1/admin/blogs/:id/author`.
 *
 * Mirrors Phase 3 Plan 04 UsersRoleController posture:
 *   - admin-only via `@Roles('admin')` (RolesGuard); service has belt-and-braces
 *     defensive admin check.
 *   - `@Audit('blogs.changeAuthor', 'blog')` — `ci:audit-required` enforces.
 *   - Server-side confirmation gate (T-07-04-04) — `confirmation === String(blog.id)`.
 *
 * Path-resolution: `:id/author` is a longer match than the bare `:id` route on
 * BlogsDetailController, so Nest correctly routes here.
 */
@Controller('admin-api/v1/admin/blogs')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class BlogsAuthorController {
    constructor(private readonly svc: BlogsAuthorService) {}

    @Patch(':id/author')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('blogs.edit')
    @Audit('blogs.changeAuthor', 'blog')
    public async changeAuthor(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: ChangeBlogAuthorDto,
    ) {
        const data = await this.svc.changeAuthor({ id: actor.id, role_name: actor.role_name }, id, dto);
        return apiResponse(1, 'ok', 'blogs.author_changed', data);
    }
}
