import {
    Body,
    Controller,
    Delete,
    Get,
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
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UpsertStoryCategoryDto } from './dto/upsert-story-category.dto';
import { StoryCategoriesService } from './story-categories.service';

/**
 * STY-02 — StoryCategory CRUD (Plan 02). Admin-only.
 *
 * Routes:
 *   GET    /admin-api/v1/admin/stories/categories         -> raw { rows }
 *   GET    /admin-api/v1/admin/stories/categories/:id     -> apiResponse-wrapped
 *   POST   /admin-api/v1/admin/stories/categories         -> apiResponse-wrapped
 *   PATCH  /admin-api/v1/admin/stories/categories/:id     -> apiResponse-wrapped
 *   DELETE /admin-api/v1/admin/stories/categories/:id     -> apiResponse-wrapped (400 on in-use)
 *
 * Note on routing: this controller's path prefix `/admin-api/v1/admin/stories/categories`
 * sits "underneath" `StoriesListController`'s `/admin-api/v1/admin/stories/:id`. Nest
 * matches routes by specificity, so `/categories` resolves to this controller before
 * Nest tries to ParseInt 'categories' as an :id parameter on the list controller.
 * Verified by inspection: StoriesDetailController's `:id` route is the one to watch;
 * since the prefix `categories` is longer-match than `:id`, this controller wins.
 */
@Controller('admin-api/v1/admin/stories/categories')
@UseGuards(JwtGuard, RolesGuard)
export class StoryCategoriesController {
    constructor(private readonly svc: StoryCategoriesService) {}

    @Get()
    @Roles('admin')
    public async list() {
        return this.svc.list();
    }

    @Get(':id')
    @Roles('admin')
    public async getDetail(@Param('id', ParseIntPipe) id: number) {
        const data = await this.svc.getDetail(id);
        return apiResponse(1, 'ok', 'stories.category.fetched', data);
    }

    @Post()
    @Roles('admin')
    @Audit('stories.category.create', 'story_category')
    public async create(@Body() dto: UpsertStoryCategoryDto) {
        const data = await this.svc.create(dto);
        return apiResponse(1, 'created', 'stories.category.created', data);
    }

    @Patch(':id')
    @Roles('admin')
    @Audit('stories.category.update', 'story_category')
    public async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpsertStoryCategoryDto) {
        const data = await this.svc.update(id, dto);
        return apiResponse(1, 'ok', 'stories.category.updated', data);
    }

    @Delete(':id')
    @Roles('admin')
    @Audit('stories.category.delete', 'story_category')
    @HttpCode(HttpStatus.OK)
    public async remove(@Param('id', ParseIntPipe) id: number) {
        const data = await this.svc.hardDelete(id);
        return apiResponse(1, 'ok', 'stories.category.deleted', data);
    }
}
