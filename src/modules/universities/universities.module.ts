import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { UniversitiesListController } from './universities-list.controller';
import { UniversitiesListService } from './universities-list.service';
import { UniversitiesDetailController } from './universities-detail.controller';
import { UniversitiesDetailService } from './universities-detail.service';
import { UniversitiesMutationsController } from './universities-mutations.controller';
import { UniversitiesMutationsService } from './universities-mutations.service';
import { UniversitiesImportController } from './universities-import.controller';
import { UniversitiesImportService } from './universities-import.service';
import { UniversitiesAnalyticsController } from './universities-analytics.controller';
import { UniversitiesAnalyticsService } from './universities-analytics.service';
import { SpecialtiesListController } from './specialties-list.controller';
import { SpecialtiesListService } from './specialties-list.service';
import { SpecialtiesMutationsController } from './specialties-mutations.controller';
import { SpecialtiesMutationsService } from './specialties-mutations.service';
import { UniversitySpecialtiesController } from './university-specialties.controller';
import { UniversitySpecialtiesService } from './university-specialties.service';
import { AdmissionStatsController } from './admission-stats.controller';
import { AdmissionStatsService } from './admission-stats.service';

/**
 * Phase 17 — Universities & Specialties catalog.
 *
 * One module covers three sub-domains (sharing the same Prisma cluster):
 *   • universities          — vuz CRUD + Excel template/export/import
 *   • specialties           — directory (code + KK title)
 *   • university_specialties — M-M links (nested under /universities/:uid/specialties)
 *   • admission_stats       — per (link, year) admission outcomes
 *
 * AccessModule provides PermissionsService for @RequirePermission gates;
 * PrismaModule + RedisModule are global (AppModule), so no imports needed here.
 */
@Module({
    imports: [AccessModule],
    controllers: [
        // Literal-path GETs MUST be registered before the `:id` detail route, otherwise
        // Express router maps `/universities/analytics` and `/universities/template/:kind`
        // to UniversitiesDetailController (ParseIntPipe → 400).
        UniversitiesListController,
        UniversitiesAnalyticsController,
        UniversitiesImportController,
        UniversitiesDetailController,
        UniversitiesMutationsController,
        SpecialtiesListController,
        SpecialtiesMutationsController,
        UniversitySpecialtiesController,
        AdmissionStatsController,
    ],
    providers: [
        UniversitiesListService,
        UniversitiesDetailService,
        UniversitiesMutationsService,
        UniversitiesImportService,
        UniversitiesAnalyticsService,
        SpecialtiesListService,
        SpecialtiesMutationsService,
        UniversitySpecialtiesService,
        AdmissionStatsService,
    ],
})
export class UniversitiesModule {}
