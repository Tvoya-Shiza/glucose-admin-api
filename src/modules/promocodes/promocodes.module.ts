import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { PromocodesListController } from './promocodes-list.controller';
import { PromocodesListService } from './promocodes-list.service';
import { PromocodesDetailController } from './promocodes-detail.controller';
import { PromocodesDetailService } from './promocodes-detail.service';
import { PromocodesMutationsController } from './promocodes-mutations.controller';
import { PromocodesMutationsService } from './promocodes-mutations.service';
import { PromocodesUsagesController } from './promocodes-usages.controller';
import { PromocodesUsagesService } from './promocodes-usages.service';
import { PromocodesCacheService } from './utils/promocodes-cache.service';

/**
 * PromocodesModule — Phase 7.
 *
 * Wave 1 (Plan 01): empty skeleton; AppModule registers it. PROMOCODE_SCOPE_RULES
 * live in promocodes.scope.ts and PROMOCODES_INVALIDATE_PATTERN constants live in
 * utils/promocodes-cache.ts.
 *
 * Wave 2 (Plan 05): controllers + services + DTOs land here:
 *   - PromocodesListController        GET    /admin-api/v1/admin/promocodes
 *   - PromocodesDetailController      GET    /admin-api/v1/admin/promocodes/:id
 *   - PromocodesMutationsController   POST/PATCH/DELETE /admin-api/v1/admin/promocodes[/:id]
 *   - PromocodesUsagesController      GET    /admin-api/v1/admin/promocodes/:id/usages
 *
 * Every controller method carries @Roles('admin') (D-20). Mutations carry @Audit (D-17).
 *
 * Note: promocodes do NOT have a bulk-status flow (D-13/D-14 — distinct model
 * from Stories/Banners/Blogs which share BlogStatus enum + bulk-status pattern).
 *
 * PrismaModule + RedisModule are global (registered in AppModule), so no imports
 * are needed here.
 */
@Module({
    imports: [AccessModule],
    controllers: [
        PromocodesListController,
        PromocodesDetailController,
        PromocodesMutationsController,
        PromocodesUsagesController,
    ],
    providers: [
        PromocodesListService,
        PromocodesDetailService,
        PromocodesMutationsService,
        PromocodesUsagesService,
        PromocodesCacheService,
    ],
    exports: [],
})
export class PromocodesModule {}
