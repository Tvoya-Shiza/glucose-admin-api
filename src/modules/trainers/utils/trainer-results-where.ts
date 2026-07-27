import { PrismaService } from '../../../prisma/prisma.service';
import { buildScopeWhere } from '../../../common/scoping/scope.helper';
import type { ScopeActor } from '../../../common/scoping/scope.types';
import { TRAINER_RESULT_SCOPE_RULES } from '../trainers.scope';

/**
 * Phase 38 — shared TrainerAttempt WHERE builder for the trainer-results list,
 * stats, and export endpoints (pattern: src/modules/quizzes/quizzes-results-where.ts).
 * One predicate, three consumers — a curator's stats, list, and export always agree.
 *
 * Owns:
 *   1. Explicit filter composition (trainer_id, user_id, status, mode,
 *      date_from/to on finished_at, q over user full_name/mobile).
 *   2. course_id → quiz.trainer_courses.some.webinar_id subquery narrowing.
 *   3. group_id narrowing, AND-merged with any `q`-search `user` predicate.
 *   4. Role scope:
 *        - admin   → no narrowing.
 *        - curator → user.group_users[*].group.supervisor_id === actor.id;
 *                    additionally, a supplied group_id must be a group the curator
 *                    supervises (silent default-deny on miss).
 *        - teacher → MANUAL two-step lookup replacing the fail-closed placeholder in
 *                    TRAINER_RESULT_SCOPE_RULES: attempts on trainers linked (via
 *                    trainer_courses) to the teacher's own webinars. Zero webinars →
 *                    default-deny; a course_id outside the owned set → default-deny.
 *
 * Returns `shortCircuit: true` when the actor's effective view is provably empty.
 * Callers MUST return a zeroed response instead of running the underlying query.
 */

export interface TrainerResultsCommonFilters {
    trainer_id?: number;
    user_id?: number;
    group_id?: number;
    /** Webinar id linked via trainer_courses. */
    course_id?: number;
    status?: 'in_progress' | 'paused' | 'finished' | 'abandoned';
    mode?: 'trainer' | 'flashcards';
    /** Unix seconds (on finished_at). */
    date_from?: number;
    /** Unix seconds (on finished_at). */
    date_to?: number;
    /** Free-text search over user.full_name / user.mobile. */
    q?: string;
}

export interface BuiltTrainerResultsWhere {
    where: Record<string, unknown>;
    shortCircuit: boolean;
}

export async function buildTrainerResultsWhere(
    actor: ScopeActor,
    filters: TrainerResultsCommonFilters,
    prisma: PrismaService,
): Promise<BuiltTrainerResultsWhere> {
    // Defensive parity with the legacy results builder: trainer_attempts only ever
    // reference kind='trainer' quizzes, but the kind pin costs nothing and keeps the
    // predicate honest if the write path ever changes.
    const quizAnd: Array<Record<string, unknown>> = [];
    const where: Record<string, unknown> = {};

    if (typeof filters.trainer_id === 'number') where.quiz_id = filters.trainer_id;
    if (typeof filters.user_id === 'number') where.user_id = filters.user_id;
    if (filters.status) where.status = filters.status;
    if (filters.mode) where.mode = filters.mode;

    if (typeof filters.date_from === 'number' || typeof filters.date_to === 'number') {
        const finishedAt: Record<string, number> = {};
        if (typeof filters.date_from === 'number') finishedAt.gte = filters.date_from;
        if (typeof filters.date_to === 'number') finishedAt.lte = filters.date_to;
        where.finished_at = finishedAt;
    }

    const needle = filters.q?.trim();
    if (needle && needle.length > 0) {
        where.user = {
            OR: [{ full_name: { contains: needle } }, { mobile: { contains: needle } }],
        };
    }

    if (typeof filters.course_id === 'number') {
        quizAnd.push({ trainer_courses: { some: { webinar_id: filters.course_id } } });
    }

    // group_id: merge into `where.user`. AND with any q-search predicate.
    if (typeof filters.group_id === 'number') {
        const groupPredicate = { group_users: { some: { group_id: filters.group_id } } };
        where.user = where.user ? { AND: [where.user, groupPredicate] } : groupPredicate;
    }

    // ---- Role scope ----
    if (actor.role_name === 'curator') {
        // Curator group_id guard: silently default-deny if curator doesn't supervise it.
        if (typeof filters.group_id === 'number') {
            const owned = await prisma.group.findFirst({
                where: { id: filters.group_id, supervisor_id: actor.id },
                select: { id: true },
            });
            if (!owned) {
                return { where: finalizeWhere(where, quizAnd), shortCircuit: true };
            }
        }

        const scopeWhere = buildScopeWhere(actor, TRAINER_RESULT_SCOPE_RULES) as Record<string, unknown>;
        // Merge: curator's `user` predicate AND'd with any existing `user` predicate
        // (from q-search OR group_id).
        if (where.user && (scopeWhere as { user?: unknown }).user) {
            where.user = { AND: [where.user, (scopeWhere as { user: unknown }).user] };
            delete (scopeWhere as { user?: unknown }).user;
        }
        Object.assign(where, scopeWhere);
    } else if (actor.role_name === 'teacher') {
        // ★ MANUAL TWO-STEP ★ replacing the fail-closed TRAINER_RESULT_SCOPE_RULES
        // placeholder (ScopeRules producers are sync — no PrismaService there).
        const teacherWebinars = await prisma.webinar.findMany({
            where: { teacher_id: actor.id },
            select: { id: true },
        });
        if (teacherWebinars.length === 0) {
            return { where: finalizeWhere(where, quizAnd), shortCircuit: true };
        }
        const ownedIds = teacherWebinars.map((w) => Number(w.id));
        if (typeof filters.course_id === 'number' && !ownedIds.includes(filters.course_id)) {
            return { where: finalizeWhere(where, quizAnd), shortCircuit: true };
        }
        quizAnd.push({ trainer_courses: { some: { webinar_id: { in: ownedIds } } } });
    }
    // admin: no narrowing.

    return { where: finalizeWhere(where, quizAnd), shortCircuit: false };
}

/** Fold the accumulated quiz-relation predicates under a single `quiz` key. */
function finalizeWhere(where: Record<string, unknown>, quizAnd: Array<Record<string, unknown>>): Record<string, unknown> {
    if (quizAnd.length === 0) {
        where.quiz = { kind: 'trainer' };
    } else if (quizAnd.length === 1) {
        where.quiz = { kind: 'trainer', ...quizAnd[0] };
    } else {
        where.quiz = { kind: 'trainer', AND: quizAnd };
    }
    return where;
}
