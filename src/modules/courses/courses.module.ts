import { Module } from '@nestjs/common';
import { CoursesListController } from './courses-list.controller';
import { CoursesListService } from './courses-list.service';

/**
 * CoursesModule — Phase 5.
 *
 * Wave 1 (Plan 01): module skeleton + WEBINAR_SCOPE_RULES + 11 DTO files + course-cache.
 * Wave 2 (Plan 02 — this): list controller + service. Mutations land in Plan 02 task 2 below.
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
    controllers: [CoursesListController],
    providers: [CoursesListService],
    exports: [],
})
export class CoursesModule {}
