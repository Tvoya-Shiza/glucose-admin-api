import { Module } from '@nestjs/common';

/**
 * QuizzesModule — Phase 6 (QZ-01..09).
 *
 * Wave 1 (Plan 01 — THIS PLAN): module skeleton + QUIZ_SCOPE_RULES + QUIZ_RESULT_SCOPE_RULES
 *                              + 13 DTO files + cache helper. NO controllers, NO services yet.
 * Wave 2 (Plan 02): list controller + list service + mutations controller + mutations service +
 *                   duplicate handler.
 * Wave 2 (Plan 03 — parallel to 02): quiz-categories controller + service.
 * Wave 3 (Plan 04): detail controller + detail service (3-step 403-not-404) + force-confirm
 *                   signer (jose, JWT_QUIZ_FORCE_SECRET).
 * Wave 4 (Plan 05): questions controller + service (4 question types + identificative pairs +
 *                   Tiptap sanitize + dnd-kit reorder + version-bump-on-destructive-edit +
 *                   question/answer image upload via Phase 5 upload-token).
 * Wave 4 (Plan 06 — parallel to 05): quiz-badges controller + service + badge-items reorder.
 * Wave 5 (Plan 07): results controller + results service (QUIZ_RESULT_SCOPE_RULES — teacher
 *                   rule composed at call site per scope file header).
 *
 * PrismaModule + RedisModule are global in AppModule (PrismaService via PrismaModule;
 * ioredis via RedisModule's global IoredisModule), so no further imports needed here.
 *
 * The CI lint at scripts/ci-audit-decorator-check.cjs walks src/modules/quizzes/**
 * controller files; this skeleton plan ships ZERO controllers, so the lint is not regressed
 * (controller count unchanged through Plan 01).
 */
@Module({
    imports: [],
    controllers: [],
    providers: [],
    exports: [],
})
export class QuizzesModule {}
