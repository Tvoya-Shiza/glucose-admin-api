import { Module } from '@nestjs/common';

/**
 * BannersModule — Phase 7.
 *
 * Wave 1 (Plan 01): empty skeleton; AppModule registers it. BANNER_SCOPE_RULES live
 * in banners.scope.ts and BANNERS_INVALIDATE_PATTERN constants live in
 * utils/banners-cache.ts.
 *
 * Wave 2 (Plan 03): controllers + services + DTOs land here (list, detail, mutations,
 * categories, bulk-status). Targets the Prisma `Advertisement` model (table
 * `advertisements`). Every controller method will carry @Roles('admin') (D-20)
 * and @Audit (D-17).
 *
 * PrismaModule + RedisModule are global (registered in AppModule), so no imports
 * are needed here.
 */
@Module({
    imports: [],
    controllers: [],
    providers: [],
    exports: [],
})
export class BannersModule {}
