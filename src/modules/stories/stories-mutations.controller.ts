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
import { UpsertStoryDto } from './dto/upsert-story.dto';
import { StoriesMutationsService } from './stories-mutations.service';

/**
 * STY-01 — admin-only story mutations (Plan 02).
 *
 * Routes:
 *   POST   /admin-api/v1/admin/stories       -> create     (admin)
 *   PATCH  /admin-api/v1/admin/stories/:id   -> update     (admin)
 *   DELETE /admin-api/v1/admin/stories/:id   -> hard delete (admin)
 *
 * RBAC: admin-only. Curator/teacher excluded at @Roles + STORY_SCOPE_RULES default-deny.
 *
 * Audit (D-17): every handler decorated with `@Audit('stories.<action>', 'story')`.
 * `ci:audit-required` enforces.
 */
@Controller('admin-api/v1/admin/stories')
@UseGuards(JwtGuard, RolesGuard)
export class StoriesMutationsController {
    constructor(private readonly svc: StoriesMutationsService) {}

    @Post()
    @Roles('admin')
    @Audit('stories.create', 'story')
    public async create(@CurrentUser() actor: AuthenticatedRequestUser, @Body() dto: UpsertStoryDto) {
        const data = await this.svc.create({ id: actor.id, role_name: actor.role_name }, dto);
        return apiResponse(1, 'created', 'stories.created', data);
    }

    @Patch(':id')
    @Roles('admin')
    @Audit('stories.update', 'story')
    public async update(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: UpsertStoryDto,
    ) {
        const data = await this.svc.update({ id: actor.id, role_name: actor.role_name }, id, dto);
        return apiResponse(1, 'ok', 'stories.updated', data);
    }

    @Delete(':id')
    @Roles('admin')
    @Audit('stories.delete', 'story')
    @HttpCode(HttpStatus.OK)
    public async remove(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
    ) {
        const data = await this.svc.hardDelete({ id: actor.id, role_name: actor.role_name }, id);
        return apiResponse(1, 'ok', 'stories.deleted', data);
    }
}
