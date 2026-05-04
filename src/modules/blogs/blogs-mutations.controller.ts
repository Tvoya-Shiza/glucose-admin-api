import {
    Body,
    Controller,
    Delete,
    HttpCode,
    HttpStatus,
    Param,
    ParseIntPipe,
    Patch,
    Post,
    UseGuards,
} from '@nestjs/common';
import { apiResponse } from '../../common/utils/api-response';
import { Audit } from '../../common/audit/audit.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { UpsertBlogDto } from './dto/upsert-blog.dto';
import { BlogsMutationsService } from './blogs-mutations.service';

/**
 * BLG-01 — admin-only blog mutations (Plan 04).
 *
 * Routes:
 *   POST   /admin-api/v1/admin/blogs       -> create     (admin)
 *   PATCH  /admin-api/v1/admin/blogs/:id   -> update     (admin)
 *   DELETE /admin-api/v1/admin/blogs/:id   -> hard delete (admin)
 *
 * RBAC: admin-only. Curator/teacher excluded at @Roles + BLOG_SCOPE_RULES default-deny.
 *
 * Audit (D-17): every handler decorated with `@Audit('blogs.<action>', 'blog')`.
 * `ci:audit-required` enforces.
 *
 * Author reassignment (BLG-03) lives on a separate controller (BlogsAuthorController)
 * to keep this surface focused on profile-shape mutations.
 */
@Controller('admin-api/v1/admin/blogs')
@UseGuards(JwtGuard, RolesGuard)
export class BlogsMutationsController {
    constructor(private readonly svc: BlogsMutationsService) {}

    @Post()
    @Roles('admin')
    @Audit('blogs.create', 'blog')
    public async create(@CurrentUser() actor: AuthenticatedRequestUser, @Body() dto: UpsertBlogDto) {
        const data = await this.svc.create({ id: actor.id, role_name: actor.role_name }, dto);
        return apiResponse(1, 'created', 'blogs.created', data);
    }

    @Patch(':id')
    @Roles('admin')
    @Audit('blogs.update', 'blog')
    public async update(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: UpsertBlogDto,
    ) {
        const data = await this.svc.update({ id: actor.id, role_name: actor.role_name }, id, dto);
        return apiResponse(1, 'ok', 'blogs.updated', data);
    }

    @Delete(':id')
    @Roles('admin')
    @Audit('blogs.delete', 'blog')
    @HttpCode(HttpStatus.OK)
    public async remove(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
    ) {
        const data = await this.svc.hardDelete({ id: actor.id, role_name: actor.role_name }, id);
        return apiResponse(1, 'ok', 'blogs.deleted', data);
    }
}
