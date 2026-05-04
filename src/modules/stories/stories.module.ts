import { Module } from '@nestjs/common';

/**
 * StoriesModule — Phase 7.
 *
 * Wave 1 (Plan 01): empty skeleton; AppModule registers it. STORY_SCOPE_RULES live
 * in stories.scope.ts and STORIES_INVALIDATE_PATTERN constants live in
 * utils/stories-cache.ts.
 *
 * Wave 2 (Plan 02): controllers + services + DTOs land here (list, detail, mutations,
 * categories, bulk-status). Every controller method will carry @Roles('admin') (D-20)
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
export class StoriesModule {}
