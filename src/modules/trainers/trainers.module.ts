import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { TrainersController } from './trainers.controller';
import { TrainersService } from './trainers.service';
import { TrainersMutationsService } from './trainers-mutations.service';
import { TrainerResultsController } from './trainer-results.controller';
import { TrainerResultsService } from './trainer-results.service';
import { TrainerResultsExportService } from './trainer-results-export.service';
import { TrainerThemesController } from './trainer-themes.controller';
import { TrainerThemesService } from './trainer-themes.service';
import { TrainersCacheService } from './utils/trainers-cache.service';

/**
 * TrainersModule — Phase 38 «Тренажёр» admin surface.
 *
 * CRUD wave: list/detail/create/update/soft-delete/publish under
 * /admin-api/v1/admin/trainers. Questions/answers reuse the existing
 * /admin-api/v1/admin/quizzes/:quizId/questions* routes (no kind filter there).
 *
 * Results wave: attempt list/stats/export under /admin-api/v1/admin/trainer-results,
 * sharing one WHERE builder (utils/trainer-results-where.ts) so the three surfaces
 * always agree for a given actor + filter set.
 *
 * PrismaModule + RedisModule are global in AppModule.
 */
@Module({
    imports: [AccessModule],
    controllers: [TrainersController, TrainerResultsController, TrainerThemesController],
    providers: [
        TrainersService,
        TrainersMutationsService,
        TrainerResultsService,
        TrainerResultsExportService,
        TrainerThemesService,
        TrainersCacheService,
    ],
    exports: [],
})
export class TrainersModule {}
