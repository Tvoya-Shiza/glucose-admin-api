import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { ListStoriesDto } from './dto/list-stories.dto';
import { StoriesListService } from './stories-list.service';

/**
 * STY-01 — GET /admin-api/v1/admin/stories.
 *
 * Returns the raw `{ rows, total, pageCount }` shape (NOT wrapped) per CLAUDE.md.
 *
 * RBAC (D-20): runtime-driven — @Roles admits admin/curator/teacher, access governed
 * by the @RequirePermission('stories.view') grant. STORY_SCOPE_RULES is {} for all
 * admitted roles (no per-row narrowing).
 *
 * Audit: GET endpoints are exempt from the `ci:audit-required` lint.
 */
@Controller('admin-api/v1/admin/stories')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class StoriesListController {
    constructor(private readonly svc: StoriesListService) {}

    @Get()
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('stories.view')
    public async list(@CurrentUser() actor: AuthenticatedRequestUser, @Query() query: ListStoriesDto) {
        return this.svc.list({ id: actor.id, role_name: actor.role_name }, query);
    }
}
