import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { apiResponse } from '../../common/utils/api-response';
import { buildScopeWhere } from '../../common/scoping/scope.helper';
import type { ScopeActor } from '../../common/scoping/scope.types';
import type { CreditDifficulty, CreditQuestionDeficit } from '@shared/credits';
import { CREDIT_SCOPE_RULES } from './credits.scope';
import { CreateLaunchDto } from './dto/create-launch.dto';
import { ListLaunchesDto } from './dto/list-launches.dto';
import type { CreditLaunchDetail, CreditSessionSummary } from './types/credits.types';
import { pickSessionQuestions, templateRequirements, type PickerCandidates, type PickerRng } from './utils/question-picker';
import { nowSec } from './utils/time';

interface CandidateSnapshot {
    question: string;
    answer: string;
    question_image: string | null;
    answer_image: string | null;
    score: number;
}

/**
 * Launch wizard (contract §launches, decisions 4–7).
 *
 * POST /credits/:id/launches runs a SINGLE interactive $transaction:
 *   credit active + scoped → students are current group members → none already
 *   passed → no pending/in_progress session → topics active (dedup) →
 *   availability per (topic × template) → per-student Fisher–Yates pick →
 *   max_score / pass_threshold resolution → attempt_number allocation →
 *   launch + sessions(status pending) + snapshot createMany.
 *
 * Snapshots (question / answer / score / difficulty / topic) are copied into
 * credit_session_questions at creation — the bank can change afterwards without
 * touching running sessions (decision 6).
 */
@Injectable()
export class CreditsLaunchService {
    private static readonly DEFAULT_PAGE_SIZE = 50;
    private static readonly MAX_PAGE_SIZE = 200;
    private static readonly TX_TIMEOUT_MS = 20_000;

    /** Injectable RNG seam — specs pin the pure picker directly; the service uses Math.random. */
    private readonly rng: PickerRng = Math.random;

    constructor(private readonly prisma: PrismaService) {}

    public async create(actor: ScopeActor, creditId: bigint, dto: CreateLaunchDto) {
        const question_count = dto.question_count ?? 5;
        const duration_sec = dto.duration_sec ?? 420;
        const pass_type = dto.pass_type ?? 'percent';
        const pass_value = dto.pass_value ?? 50;
        const template = dto.difficulty_template;
        const studentIds = Array.from(new Set(dto.student_ids));
        const topicIds = Array.from(new Set(dto.topic_ids)).map((raw) => BigInt(raw));

        if (pass_type === 'percent' && pass_value > 100) {
            throw new UnprocessableEntityException({ code: 'credits.pass_value_invalid', message: 'credits.pass_value_invalid' });
        }

        let launchId: bigint;
        try {
            launchId = await this.prisma.$transaction(
                async (tx) => {
                    // 1. Credit must be visible (scoped), alive and ACTIVE.
                    const credit = await tx.credit.findFirst({
                        where: { id: creditId, deleted_at: null, ...(buildScopeWhere(actor, CREDIT_SCOPE_RULES) as object) },
                        select: { id: true, status: true, group_id: true },
                    });
                    if (!credit) throw new NotFoundException({ code: 'credits.not_found', message: 'credits.not_found' });
                    if (credit.status !== 'active') {
                        throw new UnprocessableEntityException({ code: 'credits.not_active', message: 'credits.not_active' });
                    }

                    // 2. Every selected student is a CURRENT group member.
                    const members = await tx.groupUser.findMany({
                        where: { group_id: credit.group_id, user_id: { in: studentIds } },
                        select: { user_id: true },
                    });
                    const memberSet = new Set(members.map((m) => m.user_id));
                    const notMembers = studentIds.filter((id) => !memberSet.has(id));
                    if (notMembers.length > 0) {
                        throw new UnprocessableEntityException({
                            code: 'credits.invalid_students',
                            message: 'credits.invalid_students',
                            student_ids: notMembers,
                        });
                    }

                    // 3. None already passed this credit.
                    const passedSessions = await tx.creditSession.findMany({
                        where: { credit_id: creditId, student_id: { in: studentIds }, passed: true },
                        select: { student_id: true },
                    });
                    if (passedSessions.length > 0) {
                        throw new UnprocessableEntityException({
                            code: 'credits.already_passed',
                            message: 'credits.already_passed',
                            student_ids: Array.from(new Set(passedSessions.map((s) => s.student_id))),
                        });
                    }

                    // 4. No pending/in_progress session for any selected student.
                    const activeSessions = await tx.creditSession.findMany({
                        where: { credit_id: creditId, student_id: { in: studentIds }, status: { in: ['pending', 'in_progress'] } },
                        select: { student_id: true },
                    });
                    if (activeSessions.length > 0) {
                        throw new ConflictException({
                            code: 'credits.active_session_exists',
                            message: 'credits.active_session_exists',
                            student_ids: Array.from(new Set(activeSessions.map((s) => s.student_id))),
                        });
                    }

                    // 5. Topics must exist and be active (already deduplicated above).
                    const topics = await tx.creditTopic.findMany({
                        where: { id: { in: topicIds }, status: 'active' },
                        select: { id: true },
                    });
                    if (topics.length !== topicIds.length) {
                        const active = new Set(topics.map((t) => t.id.toString()));
                        throw new UnprocessableEntityException({
                            code: 'credits.invalid_topics',
                            message: 'credits.invalid_topics',
                            topic_ids: topicIds.filter((id) => !active.has(id.toString())).map((id) => id.toString()),
                        });
                    }

                    // 6. Load ACTIVE candidates + availability check per (topic × template).
                    const bank = await tx.creditQuestion.findMany({
                        where: { topic_id: { in: topicIds }, status: 'active' },
                        select: {
                            id: true,
                            topic_id: true,
                            difficulty: true,
                            question: true,
                            answer: true,
                            question_image: true,
                            answer_image: true,
                            score: true,
                        },
                    });
                    const candidates: PickerCandidates = {};
                    const snapshots = new Map<string, CandidateSnapshot>();
                    for (const q of bank) {
                        const topicKey = q.topic_id.toString();
                        const idKey = q.id.toString();
                        if (!candidates[topicKey]) candidates[topicKey] = { A: [], B: [], C: [] };
                        candidates[topicKey][q.difficulty as CreditDifficulty]!.push(idKey);
                        snapshots.set(idKey, {
                            question: q.question,
                            answer: q.answer,
                            question_image: q.question_image ?? null,
                            answer_image: q.answer_image ?? null,
                            score: q.score,
                        });
                    }

                    const required = templateRequirements(template);
                    const deficits: CreditQuestionDeficit[] = [];
                    for (const topicId of topicIds) {
                        for (const d of ['A', 'B', 'C'] as CreditDifficulty[]) {
                            if (required[d] === 0) continue;
                            const available = candidates[topicId.toString()]?.[d]?.length ?? 0;
                            if (available < required[d]) {
                                deficits.push({ topic_id: topicId.toString(), difficulty: d, required: required[d], available });
                            }
                        }
                    }
                    if (deficits.length > 0) {
                        throw new UnprocessableEntityException({
                            code: 'credits.question_deficit',
                            message: 'credits.question_deficit',
                            deficits,
                        });
                    }

                    // 6b. Questions this student already got (any prior non-cancelled
                    //     attempt of THIS credit) — excluded on a retake so questions
                    //     don't repeat (item 10). Passed students are already blocked
                    //     above, so this only ever narrows a failed student's retake.
                    const priorServed = await tx.creditSessionQuestion.findMany({
                        where: {
                            question_id: { not: null },
                            session: { credit_id: creditId, student_id: { in: studentIds }, status: { not: 'cancelled' } },
                        },
                        select: { question_id: true, session: { select: { student_id: true } } },
                    });
                    const servedByStudent = new Map<number, Set<string>>();
                    for (const row of priorServed) {
                        if (row.question_id == null) continue;
                        const sid = row.session.student_id;
                        let set = servedByStudent.get(sid);
                        if (!set) {
                            set = new Set<string>();
                            servedByStudent.set(sid, set);
                        }
                        set.add(row.question_id.toString());
                    }

                    // 7. Per-student pick + threshold resolution (decision 7).
                    const topicKeyList = topicIds.map((id) => id.toString());
                    const perStudent = studentIds.map((studentId) => {
                        const served = servedByStudent.get(studentId);
                        // Prefer a pool with the student's previously-served questions removed.
                        const freshCandidates =
                            served && served.size > 0 ? excludeServedCandidates(candidates, served) : candidates;
                        let pick = pickSessionQuestions({
                            topicIds: topicKeyList,
                            questionCount: question_count,
                            template,
                            candidates: freshCandidates,
                            rng: this.rng,
                        });
                        // Best-effort: if removing seen questions leaves too few for some
                        // (topic × difficulty), fall back to the full pool so a legitimate
                        // retake against a small bank still launches (repeats then allowed).
                        if (!pick.ok && served && served.size > 0) {
                            pick = pickSessionQuestions({
                                topicIds: topicKeyList,
                                questionCount: question_count,
                                template,
                                candidates,
                                rng: this.rng,
                            });
                        }
                        if (!pick.ok) {
                            // Defensive — the availability pass above already covers this.
                            throw new UnprocessableEntityException({
                                code: 'credits.question_deficit',
                                message: 'credits.question_deficit',
                                deficits: pick.deficits,
                            });
                        }
                        const max_score = pick.questions.reduce((sum, q) => sum + (snapshots.get(q.question_id)?.score ?? 0), 0);
                        let pass_threshold: number;
                        if (pass_type === 'percent') {
                            pass_threshold = Math.ceil((max_score * pass_value) / 100);
                        } else {
                            if (pass_value > max_score) {
                                throw new UnprocessableEntityException({
                                    code: 'credits.pass_value_exceeds_max',
                                    message: 'credits.pass_value_exceeds_max',
                                    student_id: studentId,
                                    max_score,
                                });
                            }
                            pass_threshold = pass_value;
                        }
                        return { studentId, questions: pick.questions, max_score, pass_threshold };
                    });

                    // 8. attempt_number = max among non-cancelled + 1 per student.
                    const attemptMax = await tx.creditSession.groupBy({
                        by: ['student_id'],
                        where: { credit_id: creditId, student_id: { in: studentIds }, status: { not: 'cancelled' } },
                        _max: { attempt_number: true },
                    });
                    const attemptBase = new Map<number, number>();
                    for (const a of attemptMax) attemptBase.set(a.student_id, a._max.attempt_number ?? 0);

                    // 9. Create launch + pending sessions + question snapshots.
                    const now = nowSec();
                    const launch = await tx.creditLaunch.create({
                        data: {
                            credit_id: creditId,
                            curator_id: actor.id,
                            topic_ids: topicIds.map((id) => Number(id)),
                            question_count,
                            difficulty_template: template,
                            duration_sec,
                            pass_type,
                            pass_value,
                            created_at: now,
                        },
                        select: { id: true },
                    });

                    for (const entry of perStudent) {
                        const session = await tx.creditSession.create({
                            data: {
                                launch_id: launch.id,
                                credit_id: creditId,
                                student_id: entry.studentId,
                                attempt_number: (attemptBase.get(entry.studentId) ?? 0) + 1,
                                max_score: entry.max_score,
                                pass_threshold: entry.pass_threshold,
                                created_at: now,
                            },
                            select: { id: true },
                        });
                        await tx.creditSessionQuestion.createMany({
                            data: entry.questions.map((q) => {
                                const snap = snapshots.get(q.question_id)!;
                                return {
                                    session_id: session.id,
                                    question_id: BigInt(q.question_id),
                                    topic_id: BigInt(q.topic_id),
                                    position: q.position,
                                    difficulty: q.difficulty,
                                    question: snap.question,
                                    answer: snap.answer,
                                    question_image: snap.question_image,
                                    answer_image: snap.answer_image,
                                    score: snap.score,
                                };
                            }),
                        });
                    }

                    return launch.id;
                },
                { timeout: CreditsLaunchService.TX_TIMEOUT_MS },
            );
        } catch (err) {
            // Unique-violation race (uniq_cs_launch_student / uniq_cs_attempt): a
            // concurrent launch grabbed the same attempt slot → 409 (contract §launches).
            if ((err as { code?: string })?.code === 'P2002') {
                throw new ConflictException({ code: 'credits.active_session_exists', message: 'credits.active_session_exists' });
            }
            throw err;
        }

        const launch = await this.buildLaunchDetail(launchId);
        return apiResponse(1, 'created', 'admin.credits.launch_created', { launch });
    }

    public async getLaunch(actor: ScopeActor, creditId: bigint, launchId: bigint) {
        await this.assertCreditVisible(actor, creditId);
        const launch = await this.buildLaunchDetail(launchId, creditId);
        return apiResponse(1, 'retrieved', 'admin.credits.launch_retrieved', { launch });
    }

    public async listLaunches(actor: ScopeActor, creditId: bigint, query: ListLaunchesDto) {
        await this.assertCreditVisible(actor, creditId);

        const page = Math.max(1, query.page ?? 1);
        const page_size = Math.min(
            CreditsLaunchService.MAX_PAGE_SIZE,
            Math.max(1, query.page_size ?? CreditsLaunchService.DEFAULT_PAGE_SIZE),
        );

        const where = { credit_id: creditId };
        const [total, raw] = await this.prisma.$transaction([
            this.prisma.creditLaunch.count({ where }),
            this.prisma.creditLaunch.findMany({
                where,
                orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
                take: page_size,
                skip: (page - 1) * page_size,
                select: {
                    id: true,
                    status: true,
                    question_count: true,
                    difficulty_template: true,
                    topic_ids: true,
                    duration_sec: true,
                    pass_type: true,
                    pass_value: true,
                    created_at: true,
                    curator: { select: { id: true, full_name: true } },
                    sessions: { select: { status: true, passed: true } },
                },
            }),
        ]);

        const rows = raw.map((l) => ({
            id: l.id,
            status: l.status,
            curator: { id: l.curator.id, full_name: l.curator.full_name },
            topic_ids: jsonIdsToStrings(l.topic_ids),
            question_count: l.question_count,
            difficulty_template: l.difficulty_template as CreditDifficulty[],
            duration_sec: l.duration_sec,
            pass_type: l.pass_type,
            pass_value: l.pass_value,
            created_at: l.created_at,
            session_count: l.sessions.length,
            passed_count: l.sessions.filter((s) => s.passed === true).length,
            active_count: l.sessions.filter((s) => s.status === 'pending' || s.status === 'in_progress').length,
        }));

        return { rows, total, pageCount: Math.max(1, Math.ceil(total / page_size)) };
    }

    // -------------------------------------------------------------- helpers

    private async assertCreditVisible(actor: ScopeActor, creditId: bigint): Promise<void> {
        const credit = await this.prisma.credit.findFirst({
            where: { id: creditId, deleted_at: null, ...(buildScopeWhere(actor, CREDIT_SCOPE_RULES) as object) },
            select: { id: true },
        });
        if (!credit) throw new NotFoundException({ code: 'credits.not_found', message: 'credits.not_found' });
    }

    private async buildLaunchDetail(launchId: bigint, expectedCreditId?: bigint): Promise<CreditLaunchDetail> {
        const l = await this.prisma.creditLaunch.findUnique({
            where: { id: launchId },
            select: {
                id: true,
                credit_id: true,
                status: true,
                topic_ids: true,
                question_count: true,
                difficulty_template: true,
                duration_sec: true,
                pass_type: true,
                pass_value: true,
                created_at: true,
                curator: { select: { id: true, full_name: true } },
                sessions: {
                    orderBy: { id: 'asc' as const },
                    select: {
                        id: true,
                        status: true,
                        attempt_number: true,
                        max_score: true,
                        passed: true,
                        ends_at: true,
                        student: { select: { id: true, full_name: true } },
                        questions: { select: { mark: true, score: true } },
                    },
                },
            },
        });
        if (!l || (expectedCreditId !== undefined && l.credit_id !== expectedCreditId)) {
            throw new NotFoundException({ code: 'credits.launch_not_found', message: 'credits.launch_not_found' });
        }

        const server_now = nowSec();
        const sessions: CreditSessionSummary[] = l.sessions.map((s) => {
            const correct_count = s.questions.filter((q) => q.mark === 'correct').length;
            const incorrect_count = s.questions.filter((q) => q.mark === 'incorrect').length;
            const answered_count = s.questions.filter((q) => q.mark !== 'pending').length;
            const score_so_far = s.questions.reduce((sum, q) => sum + (q.mark === 'correct' ? q.score : 0), 0);
            return {
                id: s.id,
                student: { id: s.student.id, full_name: s.student.full_name },
                status: s.status,
                attempt_number: s.attempt_number,
                correct_count,
                incorrect_count,
                answered_count,
                question_count: s.questions.length,
                score_so_far,
                max_score: s.max_score,
                passed: s.passed,
                ends_at: s.ends_at,
                remaining_sec: s.status === 'in_progress' && s.ends_at != null ? Math.max(0, s.ends_at - server_now) : null,
            };
        });

        return {
            id: l.id,
            credit_id: l.credit_id,
            curator: { id: l.curator.id, full_name: l.curator.full_name },
            status: l.status,
            topic_ids: jsonIdsToStrings(l.topic_ids),
            question_count: l.question_count,
            difficulty_template: l.difficulty_template as CreditDifficulty[],
            duration_sec: l.duration_sec,
            pass_type: l.pass_type,
            pass_value: l.pass_value,
            created_at: l.created_at,
            sessions,
        };
    }
}

/** topic_ids are stored as JSON numbers (schema note) — surface them as id strings like every credit-domain id. */
function jsonIdsToStrings(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.map((v) => String(v));
}

/**
 * Returns a copy of the candidate pool with `exclude`d question ids removed from
 * every (topic × difficulty) bucket. Used to keep a retake from repeating any
 * question the student already saw (item 10).
 */
function excludeServedCandidates(candidates: PickerCandidates, exclude: Set<string>): PickerCandidates {
    const out: PickerCandidates = {};
    for (const [topicKey, byDifficulty] of Object.entries(candidates)) {
        const next: Partial<Record<CreditDifficulty, string[]>> = {};
        for (const d of ['A', 'B', 'C'] as CreditDifficulty[]) {
            const pool = byDifficulty[d];
            if (pool) next[d] = pool.filter((id) => !exclude.has(id));
        }
        out[topicKey] = next;
    }
    return out;
}
