import { Module } from '@nestjs/common';

/**
 * BlogsModule — Phase 7.
 *
 * Wave 1 (Plan 01): empty skeleton; AppModule registers it. BLOG_SCOPE_RULES live
 * in blogs.scope.ts and BLOGS_INVALIDATE_PATTERN constants live in
 * utils/blogs-cache.ts.
 *
 * Wave 2 (Plan 04): controllers + services + DTOs land here (list, detail, mutations,
 * categories, bulk-status, author-change). Every controller method will carry
 * @Roles('admin') (D-20) and @Audit (D-17).
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
export class BlogsModule {}
