import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { CourseAccessController } from './course-access.controller';
import { CourseAccessService } from './course-access.service';

/**
 * Phase 18 — Course access module.
 *
 * PR-3 ships Feature A (Group → Course access) endpoints + grantUserAccess
 * used by Feature C. Feature C's listCourseAccessors + summary KPIs land in PR-5.
 *
 * AccessModule provides PermissionsService for the @RequirePermission gates;
 * PrismaModule + RedisModule are global (AppModule), so no imports needed here.
 */
@Module({
    imports: [AccessModule],
    controllers: [CourseAccessController],
    providers: [CourseAccessService],
    exports: [CourseAccessService],
})
export class CourseAccessModule {}
