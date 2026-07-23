import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { TrainersController } from './trainers.controller';
import { TrainersService } from './trainers.service';
import { TrainersMutationsService } from './trainers-mutations.service';
import { TrainersCacheService } from './utils/trainers-cache.service';

/**
 * TrainersModule — Phase 38 «Тренажёр» admin surface.
 *
 * CRUD wave: list/detail/create/update/soft-delete/publish under
 * /admin-api/v1/admin/trainers. Questions/answers reuse the existing
 * /admin-api/v1/admin/quizzes/:quizId/questions* routes (no kind filter there).
 *
 * PrismaModule + RedisModule are global in AppModule.
 */
@Module({
    imports: [AccessModule],
    controllers: [TrainersController],
    providers: [TrainersService, TrainersMutationsService, TrainersCacheService],
    exports: [],
})
export class TrainersModule {}
