import { Module } from '@nestjs/common';

/**
 * CoursesModule — Phase 5 wave-1 skeleton.
 *
 * Wave 1 (Plan 01 — this): module skeleton + WEBINAR_SCOPE_RULES + 11 DTO files
 *   + course-cache.ts utility. NO controllers / providers yet.
 * Wave 2 (Plan 02): list page + CoursesListController/Service.
 * Wave 3 (Plan 03): detail + create/update/delete + change-teacher controllers/services.
 * Wave 4 (Plan 04): upload-token + upload-file controllers/services (BFF bypass).
 * Wave 5 (Plan 05): chapter/item editor + Tiptap + reorder.
 * Wave 6 (Plan 06): per-group schedule controller/service.
 * Wave 7 (Plan 07): preview-as-student page (admin-client only — no admin-api work).
 *
 * PrismaModule is registered globally in AppModule, so we don't need to import it here
 * (matches the Phase 4 GroupsModule pattern).
 */
@Module({
    imports: [],
    controllers: [],
    providers: [],
    exports: [],
})
export class CoursesModule {}
