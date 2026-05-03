/**
 * Phase 6 Plan 05 — re-export of the Phase 5 server-side Tiptap sanitizer.
 *
 * Why a re-export?
 *   - Phase 5 owns the canonical whitelist (ALLOWED_TAGS / ALLOWED_ATTR /
 *     FORBID_TAGS / FORBID_ATTR) at
 *     `glucose-admin-api/src/modules/courses/utils/sanitize-html-server.ts`.
 *   - Phase 6 question editor lives in this module — keeping the import path
 *     stable inside `modules/quizzes/utils/` lets the questions service refer
 *     to a "phase-local" sanitize without grep'ing across modules.
 *   - The whitelist remains SINGLE-SOURCE-OF-TRUTH in Phase 5; Phase 6 inherits
 *     any tightening done there for free.
 *
 * If the Phase 6 question body ever grows tag-set divergence from the Phase 5
 * file body (e.g. allow `<table>` in questions but not in files), do NOT fork
 * here. Refactor the Phase 5 sanitizer to accept a profile parameter and pass
 * `'quiz-question'` from this re-export.
 *
 * Sanitize is invoked INSIDE the Quizzes Plan 05 $tx, before each
 * QuizQuestionTranslation.description write — defense in depth on top of the
 * client-side sanitize that runs in TiptapEditor's onUpdate.
 */
export { sanitizeTiptapHtmlServer } from '../../courses/utils/sanitize-html-server';
