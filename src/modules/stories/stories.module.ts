import { Module } from '@nestjs/common';
import { StoriesListController } from './stories-list.controller';
import { StoriesListService } from './stories-list.service';
import { StoriesDetailController } from './stories-detail.controller';
import { StoriesDetailService } from './stories-detail.service';
import { StoriesMutationsController } from './stories-mutations.controller';
import { StoriesMutationsService } from './stories-mutations.service';
import { StoriesBulkController } from './stories-bulk.controller';
import { StoriesBulkService } from './stories-bulk.service';
import { StoriesCacheService } from './utils/stories-cache.service';

/**
 * StoriesModule — Phase 7.
 *
 * Wave 1 (Plan 01): empty skeleton; AppModule registers it. STORY_SCOPE_RULES live
 * in stories.scope.ts and STORIES_INVALIDATE_PATTERN constants live in
 * utils/stories-cache.ts.
 *
 * Wave 2 (Plan 02): controllers + services + DTOs land here:
 *   - StoriesListController   GET   /admin-api/v1/admin/stories
 *   - StoriesDetailController GET   /admin-api/v1/admin/stories/:id
 *   - StoriesMutationsCtl     POST/PATCH/DELETE /admin-api/v1/admin/stories[/:id]
 *   - StoriesBulkController   POST  /admin-api/v1/admin/stories/bulk-status
 *
 * Every controller method carries @Roles('admin') (D-20). Mutations carry @Audit (D-17).
 *
 * PrismaModule + RedisModule are global (registered in AppModule), so no imports
 * are needed here.
 */
@Module({
    imports: [],
    controllers: [
        StoriesListController,
        StoriesDetailController,
        StoriesMutationsController,
        StoriesBulkController,
    ],
    providers: [
        StoriesListService,
        StoriesDetailService,
        StoriesMutationsService,
        StoriesBulkService,
        StoriesCacheService,
    ],
    exports: [],
})
export class StoriesModule {}
