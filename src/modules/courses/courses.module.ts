import { Module } from '@nestjs/common';
import { CoursesListController } from './courses-list.controller';
import { CoursesListService } from './courses-list.service';
import { CoursesMutationsController } from './courses-mutations.controller';
import { CoursesMutationsService } from './courses-mutations.service';

/**
 * CoursesModule — Phase 5.
 *
 * Wave 1 (Plan 01): module skeleton + WEBINAR_SCOPE_RULES + 11 DTO files + course-cache.
 * Wave 2 (Plan 02): list controller + service + mutations controller + service.
 * Wave 3 (Plan 03): detail + change-teacher.
 * Wave 4 (Plan 04): upload-token + upload-file (BFF bypass).
 * Wave 5 (Plan 05): chapter/item editor + Tiptap + reorder.
 * Wave 6 (Plan 06): per-group schedule controller/service.
 * Wave 7 (Plan 07): preview-as-student page (admin-client only).
 *
 * PrismaModule is registered globally in AppModule, so we don't need to import it here.
 */
@Module({
    imports: [],
    controllers: [CoursesListController, CoursesMutationsController],
    providers: [CoursesListService, CoursesMutationsService],
    exports: [],
})
export class CoursesModule {}
