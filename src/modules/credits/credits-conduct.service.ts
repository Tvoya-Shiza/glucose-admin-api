import { ConflictException, Inject, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { apiResponse } from '../../common/utils/api-response';
import { buildScopeWhere } from '../../common/scoping/scope.helper';
import type { ScopeActor } from '../../common/scoping/scope.types';
import type { CreditFinishReason } from '@shared/credits';
import { assertLaunchOwnership, CREDIT_SESSION_SCOPE_RULES } from './credits.scope';
import { CREDIT_JOURNAL_PORT, type CreditJournalPort } from './journal/credit-journal.port';
import { MarkQuestionDto } from './dto/mark-question.dto';
import { NavigateSessionDto } from './dto/navigate-session.dto';
import { ScheduleRetakeDto } from './dto/schedule-retake.dto';
import type { CreditSessionDetail } from './types/credits.types';
import { computeFinalResult, computePercent } from './utils/finalize';
import { nowSec, SESSION_GRACE_SEC } from './utils/time';

/**
 * Conduct console (contract §conduct, decisions 4 / 11 / 12).
 *
 * State machine per session:
 *   pending → in_progress (start; only ONE in_progress per launch)
 *           → cancelled   (cancel)
 *   in_progress → finished  (finish; reason 'manual')
 *               → expired   (grace overrun / cron sweep; reason 'timeout')
 *               → cancelled (cancel)
 *
 * Guarded writes (decision 11): every state-changing endpoint re-checks
 * `status='in_progress'` and the `ends_at + 5s` grace INSIDE the transaction;
 * past grace → opportunistically finalize as 'expired' (committed) and throw
 * 409 credits.session_expired.
 *
 * finalize (decision 12) is idempotent via `updateMany({ where: { id, status:
 * 'in_progress' } })` — 0 affected rows means someone else finalized first and
 * the post-commit side effects (journal / notification / launch completion)
 * are skipped.
 *
 * Every mutation responds with the SAME full session detail as GET so the
 * admin-client can setQueryData without a follow-up fetch.
 */

type TerminalStatus = 'finished' | 'expired';

interface SessionRecord {
    id: bigint;
    launch_id: bigint;
    credit_id: bigint;
    student_id: number;
    attempt_number: number;
    status: 'pending' | 'in_progress' | 'finished' | 'expired' | 'cancelled';
    current_position: number | null;
    started_at: number | null;
    ends_at: number | null;
    finished_at: number | null;
    score: number | null;
    max_score: number;
    pass_threshold: number;
    passed: boolean | null;
    retake_at: number | null;
    student: { id: number; full_name: string | null };
    launch: { id: bigint; curator_id: number; duration_sec: number };
    credit: { id: bigint; title: string; course_id: number; group_id: number };
    questions: Array<{
        position: number;
        difficulty: 'A' | 'B' | 'C';
        score: number;
        question: string;
        answer: string;
        mark: 'pending' | 'correct' | 'incorrect' | 'skipped';
        marked_at: number | null;
    }>;
}

interface FinalizeCtx {
    session: SessionRecord;
    terminalStatus: TerminalStatus;
    reason: CreditFinishReason;
    score: number;
    passed: boolean;
    finishedAt: number;
}

type GuardedOutcome =
    | { kind: 'ok' }
    | { kind: 'missing' }
    | { kind: 'not_in_progress'; status: string }
    | { kind: 'expired'; ctx: FinalizeCtx | null };

@Injectable()
export class CreditsConductService {
    private readonly logger = new Logger(CreditsConductService.name);

    constructor(
        private readonly prisma: PrismaService,
        @Inject(CREDIT_JOURNAL_PORT) private readonly journal: CreditJournalPort,
    ) {}

    // ------------------------------------------------------------------ read

    public async getSession(actor: ScopeActor, id: bigint) {
        const session = await this.loadScoped(actor, id);
        return apiResponse(1, 'retrieved', 'admin.credits.session_retrieved', this.buildDetail(session));
    }

    // ------------------------------------------------------------- mutations

    public async startSession(actor: ScopeActor, id: bigint) {
        const scoped = await this.loadScoped(actor, id);
        assertLaunchOwnership(actor, scoped.launch.curator_id);

        const outcome = await this.prisma.$transaction(async (tx): Promise<{ kind: string; status?: string }> => {
            const s = await this.loadForUpdate(tx, id);
            if (!s) return { kind: 'missing' };
            if (s.status !== 'pending') return { kind: 'not_pending', status: s.status };

            // Decision 4 — one student at a time: no OTHER in_progress session in this launch.
            const sibling = await tx.creditSession.findFirst({
                where: { launch_id: s.launch_id, status: 'in_progress', id: { not: s.id } },
                select: { id: true },
            });
            if (sibling) return { kind: 'sibling_active' };

            const now = nowSec();
            const res = await tx.creditSession.updateMany({
                where: { id: s.id, status: 'pending' },
                data: { status: 'in_progress', started_at: now, ends_at: now + s.launch.duration_sec, current_position: 1 },
            });
            return res.count === 1 ? { kind: 'ok' } : { kind: 'not_pending', status: s.status };
        });

        if (outcome.kind === 'missing') this.throwNotFound();
        if (outcome.kind === 'sibling_active') {
            throw new ConflictException({ code: 'credits.active_session_exists', message: 'credits.active_session_exists' });
        }
        if (outcome.kind === 'not_pending') {
            throw new ConflictException({ code: 'credits.session_not_pending', message: 'credits.session_not_pending', status: outcome.status });
        }

        return this.respondWithDetail(actor, id, 'admin.credits.session_started');
    }

    public async navigate(actor: ScopeActor, id: bigint, dto: NavigateSessionDto) {
        await this.runGuarded(actor, id, async (tx, s) => {
            if (dto.position > s.questions.length) {
                throw new UnprocessableEntityException({
                    code: 'credits.invalid_position',
                    message: 'credits.invalid_position',
                    question_count: s.questions.length,
                });
            }
            await tx.creditSession.updateMany({ where: { id: s.id, status: 'in_progress' }, data: { current_position: dto.position } });
        });
        return this.respondWithDetail(actor, id, 'admin.credits.session_navigated');
    }

    public async markQuestion(actor: ScopeActor, id: bigint, position: number, dto: MarkQuestionDto) {
        await this.runGuarded(actor, id, async (tx, s) => {
            const question = s.questions.find((q) => q.position === position);
            if (!question) {
                throw new NotFoundException({ code: 'credits.question_not_found', message: 'credits.question_not_found' });
            }
            // Marks stay MUTABLE until finalize (decision 11 — misclick fix).
            await tx.creditSessionQuestion.updateMany({
                where: { session_id: s.id, position },
                data: { mark: dto.mark, marked_at: nowSec(), marked_by: actor.id },
            });
        });
        return this.respondWithDetail(actor, id, 'admin.credits.session_marked');
    }

    public async finishSession(actor: ScopeActor, id: bigint) {
        const scoped = await this.loadScoped(actor, id);
        assertLaunchOwnership(actor, scoped.launch.curator_id);

        const outcome = await this.prisma.$transaction(async (tx): Promise<GuardedOutcome | { kind: 'finished'; ctx: FinalizeCtx | null }> => {
            const s = await this.loadForUpdate(tx, id);
            if (!s) return { kind: 'missing' };
            if (s.status !== 'in_progress') return { kind: 'not_in_progress', status: s.status };
            const now = nowSec();
            if (s.ends_at != null && now > s.ends_at + SESSION_GRACE_SEC) {
                return { kind: 'expired', ctx: await this.applyFinalize(tx, s, 'expired', 'timeout', now) };
            }
            return { kind: 'finished', ctx: await this.applyFinalize(tx, s, 'finished', 'manual', now) };
        });

        if (outcome.kind === 'missing') this.throwNotFound();
        if (outcome.kind === 'not_in_progress') {
            throw new ConflictException({ code: 'credits.session_finished', message: 'credits.session_finished', status: outcome.status });
        }
        if (outcome.kind === 'expired') {
            if (outcome.ctx) await this.runPostFinalizeEffects(outcome.ctx);
            throw new ConflictException({ code: 'credits.session_expired', message: 'credits.session_expired' });
        }
        if (outcome.kind === 'finished' && outcome.ctx) await this.runPostFinalizeEffects(outcome.ctx);

        return this.respondWithDetail(actor, id, 'admin.credits.session_finished');
    }

    public async cancelSession(actor: ScopeActor, id: bigint) {
        const scoped = await this.loadScoped(actor, id);
        assertLaunchOwnership(actor, scoped.launch.curator_id);

        const cancelled = await this.prisma.$transaction(async (tx) => {
            const res = await tx.creditSession.updateMany({
                where: { id, status: { in: ['pending', 'in_progress'] } },
                data: { status: 'cancelled', finished_at: nowSec() },
            });
            return res.count === 1;
        });
        if (!cancelled) {
            throw new ConflictException({ code: 'credits.session_finished', message: 'credits.session_finished', status: scoped.status });
        }

        await this.maybeCompleteLaunch(scoped.launch_id);
        return this.respondWithDetail(actor, id, 'admin.credits.session_cancelled');
    }

    public async scheduleRetake(actor: ScopeActor, id: bigint, dto: ScheduleRetakeDto) {
        const scoped = await this.loadScoped(actor, id);
        assertLaunchOwnership(actor, scoped.launch.curator_id);

        // Retakes only make sense on a finalized, NON-passed attempt.
        const finalized = scoped.status === 'finished' || scoped.status === 'expired';
        if (!finalized || scoped.passed === true) {
            throw new ConflictException({ code: 'credits.retake_not_allowed', message: 'credits.retake_not_allowed', status: scoped.status });
        }

        await this.prisma.creditSession.update({ where: { id }, data: { retake_at: dto.retake_at } });
        return this.respondWithDetail(actor, id, 'admin.credits.session_retake_scheduled');
    }

    // ------------------------------------------------- finalize (cron shares)

    /**
     * Finalizes one session as finished|expired. Idempotent: the updateMany
     * status predicate makes double-finalize a no-op (no duplicate side effects).
     * Used by the finish endpoint, the guarded-write grace path and the expiry cron.
     */
    public async finalizeSession(id: bigint, terminalStatus: TerminalStatus, reason: CreditFinishReason): Promise<void> {
        const ctx = await this.prisma.$transaction(async (tx) => {
            const s = await this.loadForUpdate(tx, id);
            if (!s || s.status !== 'in_progress') return null;
            return this.applyFinalize(tx, s, terminalStatus, reason, nowSec());
        });
        if (ctx) await this.runPostFinalizeEffects(ctx);
    }

    /** Score + flip inside the caller's transaction. Returns null when another writer already finalized. */
    private async applyFinalize(
        tx: any,
        s: SessionRecord,
        terminalStatus: TerminalStatus,
        reason: CreditFinishReason,
        now: number,
    ): Promise<FinalizeCtx | null> {
        const { score, passed } = computeFinalResult(
            s.questions.map((q) => ({ score: q.score, mark: q.mark })),
            s.pass_threshold,
        );
        const res = await tx.creditSession.updateMany({
            where: { id: s.id, status: 'in_progress' },
            data: { status: terminalStatus, score, passed, finished_at: now },
        });
        if (res.count === 0) return null;
        return { session: s, terminalStatus, reason, score, passed, finishedAt: now };
    }

    /**
     * Post-commit side effects (decision 12): journal → student notification →
     * launch completion. Each guarded independently — a failure is logged, never
     * bubbled (the finalize itself is already committed).
     */
    private async runPostFinalizeEffects(ctx: FinalizeCtx): Promise<void> {
        const { session, score, passed, finishedAt } = ctx;
        const percent = computePercent(score, session.max_score);

        try {
            await this.journal.record({
                session_id: session.id.toString(),
                credit_id: session.credit_id.toString(),
                student_id: session.student_id,
                course_id: session.credit.course_id,
                group_id: session.credit.group_id,
                attempt_number: session.attempt_number,
                score,
                max_score: session.max_score,
                percent,
                passed,
                finished_at: finishedAt,
            });
        } catch (err) {
            this.logger.warn(`credit-journal record failed session=${session.id.toString()}: ${(err as Error)?.message}`);
        }

        try {
            await this.prisma.notification.create({
                data: {
                    user_id: session.student_id,
                    title: 'Зачёт нәтижесі',
                    message:
                        `«${session.credit.title}» зачёты: ${score}/${session.max_score} ұпай (${percent}%) — ` +
                        (passed ? 'тапсырылды' : 'тапсырылмады'),
                    kind: 'credit_result',
                    deep_link: `/credits/sessions/${session.id.toString()}/result`,
                    sender: 'system',
                    type: 'single',
                    created_at: finishedAt,
                },
            });
        } catch (err) {
            this.logger.warn(`credit_result notification failed session=${session.id.toString()}: ${(err as Error)?.message}`);
        }

        await this.maybeCompleteLaunch(session.launch_id);
    }

    /** Launch → completed once no pending/in_progress sessions remain (decision 12). */
    private async maybeCompleteLaunch(launchId: bigint): Promise<void> {
        try {
            const remaining = await this.prisma.creditSession.count({
                where: { launch_id: launchId, status: { in: ['pending', 'in_progress'] } },
            });
            if (remaining === 0) {
                await this.prisma.creditLaunch.updateMany({ where: { id: launchId, status: 'active' }, data: { status: 'completed' } });
            }
        } catch (err) {
            this.logger.warn(`launch completion check failed launch=${launchId.toString()}: ${(err as Error)?.message}`);
        }
    }

    // -------------------------------------------------------------- plumbing

    /**
     * Guarded-write runner (decision 11): ownership → transaction → re-check
     * in_progress + grace → write. Past grace: finalize as expired (COMMITTED),
     * then 409 credits.session_expired after the side effects run.
     */
    private async runGuarded(actor: ScopeActor, id: bigint, write: (tx: any, s: SessionRecord) => Promise<void>): Promise<void> {
        const scoped = await this.loadScoped(actor, id);
        assertLaunchOwnership(actor, scoped.launch.curator_id);

        const outcome = await this.prisma.$transaction(async (tx): Promise<GuardedOutcome> => {
            const s = await this.loadForUpdate(tx, id);
            if (!s) return { kind: 'missing' };
            if (s.status !== 'in_progress') return { kind: 'not_in_progress', status: s.status };
            const now = nowSec();
            if (s.ends_at != null && now > s.ends_at + SESSION_GRACE_SEC) {
                return { kind: 'expired', ctx: await this.applyFinalize(tx, s, 'expired', 'timeout', now) };
            }
            await write(tx, s);
            return { kind: 'ok' };
        });

        if (outcome.kind === 'missing') this.throwNotFound();
        if (outcome.kind === 'not_in_progress') {
            throw new ConflictException({ code: 'credits.session_finished', message: 'credits.session_finished', status: outcome.status });
        }
        if (outcome.kind === 'expired') {
            if (outcome.ctx) await this.runPostFinalizeEffects(outcome.ctx);
            throw new ConflictException({ code: 'credits.session_expired', message: 'credits.session_expired' });
        }
    }

    private sessionInclude() {
        return {
            student: { select: { id: true, full_name: true } },
            launch: { select: { id: true, curator_id: true, duration_sec: true } },
            credit: { select: { id: true, title: true, course_id: true, group_id: true } },
            questions: {
                orderBy: { position: 'asc' as const },
                select: {
                    position: true,
                    difficulty: true,
                    score: true,
                    question: true,
                    answer: true,
                    mark: true,
                    marked_at: true,
                },
            },
        };
    }

    /** Scoped read — any curator of the credit's group may view (contract §conduct). */
    private async loadScoped(actor: ScopeActor, id: bigint): Promise<SessionRecord> {
        const s = await this.prisma.creditSession.findFirst({
            where: { id, ...(buildScopeWhere(actor, CREDIT_SESSION_SCOPE_RULES) as object) },
            include: this.sessionInclude(),
        });
        if (!s) this.throwNotFound();
        return s as unknown as SessionRecord;
    }

    /** Unscoped re-read inside a transaction (scope/ownership already proven by the caller). */
    private async loadForUpdate(tx: any, id: bigint): Promise<SessionRecord | null> {
        const s = await tx.creditSession.findUnique({ where: { id }, include: this.sessionInclude() });
        return (s as unknown as SessionRecord) ?? null;
    }

    private async respondWithDetail(actor: ScopeActor, id: bigint, message: string) {
        const fresh = await this.loadScoped(actor, id);
        return apiResponse(1, 'success', message, this.buildDetail(fresh));
    }

    private buildDetail(s: SessionRecord): CreditSessionDetail {
        const server_now = nowSec();
        const finalized = s.status === 'finished' || s.status === 'expired';
        return {
            id: s.id,
            launch_id: s.launch_id,
            credit_id: s.credit_id,
            student: { id: s.student.id, full_name: s.student.full_name },
            status: s.status,
            attempt_number: s.attempt_number,
            current_position: s.current_position,
            duration_sec: s.launch.duration_sec,
            started_at: s.started_at,
            ends_at: s.ends_at,
            server_now,
            remaining_sec: s.status === 'in_progress' && s.ends_at != null ? Math.max(0, s.ends_at - server_now) : null,
            questions: s.questions.map((q) => ({
                position: q.position,
                difficulty: q.difficulty,
                score: q.score,
                question: q.question,
                answer: q.answer,
                mark: q.mark,
                marked_at: q.marked_at,
            })),
            result:
                finalized && s.score != null && s.passed != null
                    ? {
                          score: s.score,
                          max_score: s.max_score,
                          percent: computePercent(s.score, s.max_score),
                          passed: s.passed,
                          pass_threshold: s.pass_threshold,
                          finish_reason: s.status === 'expired' ? 'timeout' : 'manual',
                      }
                    : null,
            retake_at: s.retake_at,
        };
    }

    private throwNotFound(): never {
        throw new NotFoundException({ code: 'credits.session_not_found', message: 'credits.session_not_found' });
    }
}
