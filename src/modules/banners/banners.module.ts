import { Module } from '@nestjs/common';
import { BannersListController } from './banners-list.controller';
import { BannersListService } from './banners-list.service';
import { BannersDetailController } from './banners-detail.controller';
import { BannersDetailService } from './banners-detail.service';
import { BannersMutationsController } from './banners-mutations.controller';
import { BannersMutationsService } from './banners-mutations.service';
import { BannersBulkController } from './banners-bulk.controller';
import { BannersBulkService } from './banners-bulk.service';
import { BannerCategoriesController } from './banner-categories.controller';
import { BannerCategoriesService } from './banner-categories.service';
import { BannersCacheService } from './utils/banners-cache.service';

/**
 * BannersModule — Phase 7.
 *
 * Wave 1 (Plan 01): empty skeleton; AppModule registers it. BANNER_SCOPE_RULES live
 * in banners.scope.ts and BANNERS_INVALIDATE_PATTERN constants live in
 * utils/banners-cache.ts.
 *
 * Wave 2 (Plan 03): controllers + services + DTOs land here:
 *   - BannersListController     GET   /admin-api/v1/admin/banners
 *   - BannersDetailController   GET   /admin-api/v1/admin/banners/:id
 *   - BannersMutationsCtl       POST/PATCH/DELETE /admin-api/v1/admin/banners[/:id]
 *   - BannersBulkController     POST  /admin-api/v1/admin/banners/bulk-status
 *   - BannerCategoriesCtl       GET/POST/PATCH/DELETE /admin-api/v1/admin/banners/categories[/:id]
 *
 * Targets the Prisma `Advertisement` model (table `advertisements`). Every controller
 * method carries @Roles('admin') (D-20). Mutations carry @Audit (D-17) with entity
 * `advertisement` (or `advertisement_category` for the category surface).
 *
 * PrismaModule + RedisModule are global (registered in AppModule), so no imports
 * are needed here.
 */
@Module({
    imports: [],
    controllers: [
        BannersListController,
        BannersDetailController,
        BannersMutationsController,
        BannersBulkController,
        BannerCategoriesController,
    ],
    providers: [
        BannersListService,
        BannersDetailService,
        BannersMutationsService,
        BannersBulkService,
        BannerCategoriesService,
        BannersCacheService,
    ],
    exports: [],
})
export class BannersModule {}
