import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { ListBlogsDto } from './dto/list-blogs.dto';
import { BlogsListService } from './blogs-list.service';

/**
 * BLG-01 — GET /admin-api/v1/admin/blogs.
 *
 * Returns the raw `{ rows, total, pageCount }` shape (NOT wrapped) per CLAUDE.md.
 *
 * RBAC: runtime-driven. @Roles('admin','curator','teacher') + @RequirePermission('blogs.view')
 * govern visibility — no scope-level row-narrowing.
 */
@Controller('admin-api/v1/admin/blogs')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class BlogsListController {
    constructor(private readonly svc: BlogsListService) {}

    @Get()
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('blogs.view')
    public async list(@CurrentUser() actor: AuthenticatedRequestUser, @Query() query: ListBlogsDto) {
        return this.svc.list({ id: actor.id, role_name: actor.role_name }, query);
    }
}
