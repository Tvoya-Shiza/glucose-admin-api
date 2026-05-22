import { PrismaService } from '../../prisma/prisma.service';
import { buildScopeWhere } from '../../common/scoping/scope.helper';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { QUIZ_RESULT_SCOPE_RULES } from './quizzes.scope';

/**
 * Shared QuizResult WHERE builder for Plan 07's list endpoint and the new
 * stats endpoint. Owns:
 *   1. Explicit filter composition (quiz_id, user_id, status, date_from/to, q).
 *   2. badge_id → quiz_id IN [...] resolution (T-06-83).
 *   3. group_id narrowing, AND-merged with any `q`-search `user` predicate.
 *   4. Role scope:
 *        - admin   → no narrowing.
 *        - curator → user.group_users[*].group.supervisor_id === actor.id;
 *                    additionally, if group_id is set it must be a group the
 *                    curator supervises (silent default-deny on miss).
 *        - teacher → MANUAL two-step lookup on own webinars (default-deny if
 *                    teacher has zero webinars).
 *
 * Returns `shortCircuit: true` when the actor's effective view is provably
 * empty (curator pointed at a foreign group, teacher with no webinars, or a
 * badge_id whose explicit quiz_id is not part of that badge). Callers must
 * return a zeroed response instead of running the underlying query.
 */

export interface ResultsCommonFilters {
    quiz_id?: number;
    badge_id?: number;
    group_id?: number;
    user_id?: number;
    status?: 'waiting' | 'passed' | 'failed';
    /** Unix seconds. */
    date_from?: number;
    /** Unix seconds. */
    date_to?: number;
    /** Free-text search over user.full_name / user.email. */
    q?: string;
}

export interface BuiltResultsWhere {
    where: Record<string, unknown>;
    shortCircuit: boolean;
}

/**
 * Compose the WHERE clause for a quiz-result query. `prisma` is needed for
 * badge_id resolution, the curator group validation, and the teacher webinar
 * two-step.
 */
export async function buildResultsWhere(
    actor: ScopeActor,
    filters: ResultsCommonFilters,
    prisma: PrismaService,
): Promise<BuiltResultsWhere> {
    const where: Record<string, unknown> = {};

    if (typeof filters.quiz_id === 'number') where.quiz_id = filters.quiz_id;
    if (typeof filters.user_id === 'number') where.user_id = filters.user_id;
    if (filters.status) where.status = filters.status;

    if (typeof filters.date_from === 'number' || typeof filters.date_to === 'number') {
        const createdAt: Record<string, number> = {};
        if (typeof filters.date_from === 'number') createdAt.gte = filters.date_from;
        if (typeof filters.date_to === 'number') createdAt.lte = filters.date_to;
        where.created_at = createdAt;
    }

    const needle = filters.q?.trim();
    if (needle && needle.length > 0) {
        where.user = {
            OR: [{ full_name: { contains: needle } }, { email: { contains: needle } }],
        };
    }

    // badge_id → quiz_id IN [...]. Mirrors quizzes-results.service.ts pre-extraction.
    if (typeof filters.badge_id === 'number') {
        const items = await prisma.quizBadgeItem.findMany({
            where: { quiz_badge_id: filters.badge_id },
            select: { quiz_id: true },
        });
        const quizIds = items.map((i) => i.quiz_id);

        if (typeof filters.quiz_id === 'number') {
            if (!quizIds.includes(filters.quiz_id)) {
                return { where, shortCircuit: true };
            }
        } else {
            where.quiz_id = quizIds.length > 0 ? { in: quizIds } : { in: [-1] };
        }
    }

    // group_id: merge into `where.user`. AND with any q-search predicate.
    if (typeof filters.group_id === 'number') {
        const groupPredicate = {
            group_users: { some: { group_id: filters.group_id } },
        };
        if (where.user) {
            where.user = { AND: [where.user, groupPredicate] };
        } else {
            where.user = groupPredicate;
        }
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
                return { where, shortCircuit: true };
            }
        }

        const scopeWhere = buildScopeWhere(actor, QUIZ_RESULT_SCOPE_RULES) as Record<string, unknown>;
        // Merge: curator's `user` predicate AND'd with any existing `user` predicate
        // (from q-search OR group_id).
        if (where.user && (scopeWhere as { user?: unknown }).user) {
            where.user = { AND: [where.user, (scopeWhere as { user: unknown }).user] };
            delete (scopeWhere as { user?: unknown }).user;
        }
        Object.assign(where, scopeWhere);
    } else if (actor.role_name === 'teacher') {
        const teacherWebinars = await prisma.webinar.findMany({
            where: { teacher_id: actor.id },
            select: { id: true },
        });
        if (teacherWebinars.length === 0) {
            return { where, shortCircuit: true };
        }
        where.webinar_id = { in: teacherWebinars.map((w) => w.id) };
    }
    // admin: no narrowing.

    return { where, shortCircuit: false };
}
