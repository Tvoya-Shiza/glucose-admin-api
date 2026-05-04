import { Module } from '@nestjs/common';
import { BlogsListController } from './blogs-list.controller';
import { BlogsListService } from './blogs-list.service';
import { BlogsDetailController } from './blogs-detail.controller';
import { BlogsDetailService } from './blogs-detail.service';
import { BlogsMutationsController } from './blogs-mutations.controller';
import { BlogsMutationsService } from './blogs-mutations.service';
import { BlogsBulkController } from './blogs-bulk.controller';
import { BlogsBulkService } from './blogs-bulk.service';
import { BlogsAuthorController } from './blogs-author.controller';
import { BlogsAuthorService } from './blogs-author.service';
import { BlogCategoriesController } from './blog-categories.controller';
import { BlogCategoriesService } from './blog-categories.service';
import { BlogsCacheService } from './utils/blogs-cache.service';

/**
 * BlogsModule — Phase 7 Plan 04.
 *
 * Wave 1 (Plan 01): empty skeleton. BLOG_SCOPE_RULES live in blogs.scope.ts and
 * BLOGS_INVALIDATE_PATTERN constants live in utils/blogs-cache.ts.
 *
 * Wave 2 (Plan 04): controllers + services + DTOs land here:
 *   - BlogsListController     GET   /admin-api/v1/admin/blogs
 *   - BlogsDetailController   GET   /admin-api/v1/admin/blogs/:id
 *   - BlogsMutationsCtl       POST/PATCH/DELETE /admin-api/v1/admin/blogs[/:id]
 *   - BlogsBulkController     POST  /admin-api/v1/admin/blogs/bulk-status
 *   - BlogsAuthorController   PATCH /admin-api/v1/admin/blogs/:id/author      (BLG-03 / D-11)
 *   - BlogCategoriesCtl       GET/POST/PATCH/DELETE /admin-api/v1/admin/blogs/categories[/:id]
 *
 * Every controller method carries @Roles('admin') (D-20). Mutations carry @Audit (D-17).
 *
 * Tiptap content writes (BlogTranslation.content) are sanitized via
 * `utils/sanitize-html-server.ts` (T-07-04-02 — defense in depth, mirrors Phase 5
 * Plan 05 courses surface).
 *
 * PrismaModule + RedisModule are global (registered in AppModule), so no imports
 * are needed here.
 */
@Module({
    imports: [],
    controllers: [
        BlogsListController,
        BlogsDetailController,
        BlogsMutationsController,
        BlogsBulkController,
        BlogsAuthorController,
        BlogCategoriesController,
    ],
    providers: [
        BlogsListService,
        BlogsDetailService,
        BlogsMutationsService,
        BlogsBulkService,
        BlogsAuthorService,
        BlogCategoriesService,
        BlogsCacheService,
    ],
    exports: [],
})
export class BlogsModule {}
