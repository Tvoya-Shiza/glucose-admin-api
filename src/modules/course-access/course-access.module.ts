import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { CoursesModule } from '../courses/courses.module';
import { CourseAccessController } from './course-access.controller';
import { CourseAccessService } from './course-access.service';

/**
 * Phase 18 — Course access module.
 *
 * PR-3 ships Feature A (Group → Course access) endpoints + grantUserAccess
 * used by Feature C. Feature C's listCourseAccessors + summary KPIs land in PR-5.
 *
 * AccessModule provides PermissionsService for the @RequirePermission gates;
 * CoursesModule provides CoursesProgressService for per-user progress aggregates
 * surfaced in the accessors table; PrismaModule + RedisModule are global
 * (AppModule), so no imports needed for those.
 */
@Module({
    imports: [AccessModule, CoursesModule],
    controllers: [CourseAccessController],
    providers: [CourseAccessService],
    exports: [CourseAccessService],
})
export class CourseAccessModule {}
