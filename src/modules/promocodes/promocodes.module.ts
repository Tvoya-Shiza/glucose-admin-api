import { Module } from '@nestjs/common';

/**
 * PromocodesModule — Phase 7.
 *
 * Wave 1 (Plan 01): empty skeleton; AppModule registers it. PROMOCODE_SCOPE_RULES
 * live in promocodes.scope.ts and PROMOCODES_INVALIDATE_PATTERN constants live in
 * utils/promocodes-cache.ts.
 *
 * Wave 2 (Plan 05): controllers + services + DTOs land here (list, detail, mutations,
 * usages list). Every controller method will carry @Roles('admin') (D-20) and
 * @Audit (D-17). Note: promocodes do NOT have a bulk-status flow (D-13).
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
export class PromocodesModule {}
