import { Module } from '@nestjs/common';
import { QuizzesListController } from './quizzes-list.controller';
import { QuizzesListService } from './quizzes-list.service';
import { QuizzesMutationsController } from './quizzes-mutations.controller';
import { QuizzesMutationsService } from './quizzes-mutations.service';
import { QuizzesDuplicateController } from './quizzes-duplicate.controller';
import { QuizzesDuplicateService } from './quizzes-duplicate.service';
import { QuizCategoriesController } from './quiz-categories.controller';
import { QuizCategoriesService } from './quiz-categories.service';
import { QuizzesCacheService } from './utils/quizzes-cache.service';

/**
 * QuizzesModule — Phase 6 (QZ-01..09).
 *
 * Wave 1 (Plan 01): module skeleton + QUIZ_SCOPE_RULES + QUIZ_RESULT_SCOPE_RULES
 *                  + 13 DTO files + cache helper.
 * Wave 2 (Plan 02): list controller + list service + mutations controller +
 *                  mutations service + duplicate controller + duplicate service.
 * Wave 2 (Plan 03 — THIS PLAN): quiz-categories controller + service (tree CRUD,
 *                              cycle protection, force-delete repoint).
 * Wave 3 (Plan 04): detail controller + detail service + force-confirm signer.
 * Wave 4 (Plan 05): questions controller + service.
 * Wave 4 (Plan 06): quiz-badges controller + service + badge-items reorder.
 * Wave 5 (Plan 07): results controller + results service.
 *
 * PrismaModule + RedisModule are global in AppModule.
 */
@Module({
    imports: [],
    controllers: [
        QuizzesListController,
        QuizzesMutationsController,
        QuizzesDuplicateController,
        QuizCategoriesController,
    ],
    providers: [
        QuizzesListService,
        QuizzesMutationsService,
        QuizzesDuplicateService,
        QuizCategoriesService,
        QuizzesCacheService,
    ],
    exports: [],
})
export class QuizzesModule {}
