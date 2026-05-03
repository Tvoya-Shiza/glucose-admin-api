import { Module } from '@nestjs/common';
import { CoursesListController } from './courses-list.controller';
import { CoursesListService } from './courses-list.service';
import { CoursesMutationsController } from './courses-mutations.controller';
import { CoursesMutationsService } from './courses-mutations.service';
import { CoursesDetailController } from './courses-detail.controller';
import { CoursesDetailService } from './courses-detail.service';
import { CoursesContentController } from './courses-content.controller';
import { CoursesContentService } from './courses-content.service';
import { CoursesScheduleController } from './courses-schedule.controller';
import { CoursesScheduleService } from './courses-schedule.service';
import { CoursesTeacherController } from './courses-teacher.controller';
import { CoursesTeacherService } from './courses-teacher.service';
import { CoursesPreviewController } from './courses-preview.controller';
import { CoursesPreviewService } from './courses-preview.service';
import { CoursesCacheService } from './utils/courses-cache.service';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';
import { UploadTokenGuard } from './upload-token.guard';

/**
 * CoursesModule — Phase 5.
 *
 * Wave 1 (Plan 01): module skeleton + WEBINAR_SCOPE_RULES + 11 DTO files + course-cache helpers.
 * Wave 2 (Plan 02): list controller + service + mutations controller + service.
 * Wave 3 (Plan 03): detail controller + service (3-step 403-not-404)
 *                   + CoursesCacheService wire-up (Plan 02 deferred — flipped here).
 * Wave 4 (Plan 04): upload-token + upload-file (BFF bypass).
 * Wave 5 (Plan 05): chapter/item editor + Tiptap + reorder.
 * Wave 6 (Plan 06): per-group schedule controller/service.
 * Wave 7 (Plan 07): teacher-change controller/service (CRS-06, admin-only audited)
 *                   + preview-as-student controller/service (CRS-09, read-only mirror).
 *
 * PrismaModule + RedisModule are registered globally in AppModule (PrismaService
 * via PrismaModule; ioredis Redis client via RedisModule.@Global IoredisModule),
 * so we don't need to import them here.
 */
@Module({
    imports: [],
    controllers: [
        CoursesListController,
        CoursesMutationsController,
        CoursesDetailController,
        CoursesContentController,
        CoursesScheduleController,
        CoursesTeacherController,
        CoursesPreviewController,
        UploadsController,
    ],
    providers: [
        CoursesListService,
        CoursesMutationsService,
        CoursesDetailService,
        CoursesContentService,
        CoursesScheduleService,
        CoursesTeacherService,
        CoursesPreviewService,
        CoursesCacheService,
        UploadsService,
        UploadTokenGuard,
    ],
    exports: [],
})
export class CoursesModule {}
