import { Module } from '@nestjs/common';
import { QuizzesListController } from './quizzes-list.controller';
import { QuizzesListService } from './quizzes-list.service';
import { QuizzesMutationsController } from './quizzes-mutations.controller';
import { QuizzesMutationsService } from './quizzes-mutations.service';
import { QuizzesDuplicateController } from './quizzes-duplicate.controller';
import { QuizzesDuplicateService } from './quizzes-duplicate.service';
import { QuizzesCacheService } from './utils/quizzes-cache.service';

/**
 * QuizzesModule — Phase 6 (QZ-01..09).
 *
 * Wave 1 (Plan 01): module skeleton + QUIZ_SCOPE_RULES + QUIZ_RESULT_SCOPE_RULES
 *                  + 13 DTO files + cache helper.
 * Wave 2 (Plan 02 — THIS PLAN): list controller + list service + mutations controller +
 *                              mutations service + duplicate controller + duplicate
 *                              service + QuizzesCacheService wire-up.
 * Wave 2 (Plan 03 — parallel): quiz-categories controller + service.
 * Wave 3 (Plan 04): detail controller + detail service (3-step 403-not-404) + force-confirm
 *                   signer (jose, JWT_QUIZ_FORCE_SECRET).
 * Wave 4 (Plan 05): questions controller + service (4 question types + identificative pairs +
 *                   Tiptap sanitize + dnd-kit reorder + version-bump-on-destructive-edit +
 *                   question/answer image upload via Phase 5 upload-token).
 * Wave 4 (Plan 06): quiz-badges controller + service + badge-items reorder.
 * Wave 5 (Plan 07): results controller + results service.
 *
 * PrismaModule + RedisModule are global in AppModule.
 */
@Module({
    imports: [],
    controllers: [QuizzesListController, QuizzesMutationsController, QuizzesDuplicateController],
    providers: [QuizzesListService, QuizzesMutationsService, QuizzesDuplicateService, QuizzesCacheService],
    exports: [],
})
export class QuizzesModule {}
