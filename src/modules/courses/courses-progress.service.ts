import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { QuizResultStatus, WebinarAssignmentHistoryStatus } from 'generated/prisma';
import { PrismaService } from '../../prisma/prisma.service';
import type { ProgressReportQueryDto } from './dto/progress-report-query.dto';
import type {
    ProgressAggregateDto,
    ProgressChapterDto,
    ProgressGroupCompletionDto,
    ProgressItemDto,
    ProgressReportDto,
    ProgressTargetSummaryDto,
    ProgressUserStatusDto,
} from './dto/progress-report.dto';

/**
 * Phase 19 / Feature B2 — admin read-only progress report.
 *
 * Single endpoint serving BOTH targets (user / group):
 *   - 'user'  → per-item status (status / score / grade / attempts / last_at)
 *   - 'group' → per-item completion ratio (done / total / ratio across members)
 *
 * Heavy aggregations are batched with Prisma `groupBy` + `findMany` then merged
 * in JS. Admin-data scale assumption: a course rarely exceeds a few hundred
 * items, and a group rarely exceeds a few thousand members.
 *
 * The report is uncached — its scope is per-target and operators want it
 * fresh. If perf becomes a concern, add a short Redis cache keyed by
 * (target_kind, target_id, course_id) with 60s TTL.
 */
@Injectable()
export class CoursesProgressService {
    private readonly logger = new Logger(CoursesProgressService.name);

    constructor(private readonly prisma: PrismaService) {}

    public async getReport(
        courseId: number,
        query: ProgressReportQueryDto,
    ): Promise<ProgressReportDto> {
        const course = await this.prisma.webinar.findUnique({
            where: { id: courseId },
            select: { id: true, deleted_at: true, slug: true },
        });
        if (!course || course.deleted_at !== null) {
            throw new NotFoundException('courses.not_found');
        }

        const chapters = await this.fetchChaptersWithItems(courseId);
        const itemBuckets = this.bucketItems(chapters);

        const targetSummary = await this.resolveTarget(query);
        if (query.target_kind === 'user') {
            return this.buildUserReport(courseId, query.target_id, chapters, itemBuckets, targetSummary);
        }
        return this.buildGroupReport(courseId, query.target_id, chapters, itemBuckets, targetSummary);
    }

    // -----------------------------------------------------------------------
    // Per-user
    // -----------------------------------------------------------------------

    private async buildUserReport(
        courseId: number,
        userId: number,
        chapters: ChapterWithItems[],
        buckets: ItemBuckets,
        target: ProgressTargetSummaryDto,
    ): Promise<ProgressReportDto> {
        const [learnings, quizResults, assignmentHistories, titleMaps] = await Promise.all([
            buckets.fileIds.length > 0
                ? this.prisma.courseLearning.findMany({
                      where: { user_id: userId, file_id: { in: buckets.fileIds } },
                      select: { file_id: true, created_at: true },
                  })
                : Promise.resolve([] as Array<{ file_id: number; created_at: number }>),
            buckets.quizIds.length > 0
                ? this.prisma.quizResult.findMany({
                      where: { user_id: userId, quiz_id: { in: buckets.quizIds } },
                      orderBy: { created_at: 'desc' },
                      select: { quiz_id: true, status: true, user_grade: true, created_at: true },
                  })
                : Promise.resolve(
                      [] as Array<{
                          quiz_id: number;
                          status: QuizResultStatus;
                          user_grade: number | null;
                          created_at: number;
                      }>,
                  ),
            buckets.assignmentIds.length > 0
                ? this.prisma.webinarAssignmentHistory.findMany({
                      where: { student_id: userId, assignment_id: { in: buckets.assignmentIds } },
                      orderBy: { created_at: 'desc' },
                      select: {
                          assignment_id: true,
                          status: true,
                          grade: true,
                          created_at: true,
                      },
                  })
                : Promise.resolve(
                      [] as Array<{
                          assignment_id: number;
                          status: WebinarAssignmentHistoryStatus;
                          grade: number | null;
                          created_at: bigint;
                      }>,
                  ),
            this.loadItemTitles(buckets),
        ]);

        // Index per (id) — for files: at most one row (UNIQUE(user_id, file_id)).
        const learningByFile = new Map<number, number>();
        for (const l of learnings) learningByFile.set(l.file_id, l.created_at);

        // For quiz / assignment: keep all attempts to compute best-of + count + latest_at.
        const quizByQuiz = new Map<
            number,
            Array<{ status: QuizResultStatus; user_grade: number | null; created_at: number }>
        >();
        for (const q of quizResults) {
            const arr = quizByQuiz.get(q.quiz_id) ?? [];
            arr.push({ status: q.status, user_grade: q.user_grade ?? null, created_at: q.created_at });
            quizByQuiz.set(q.quiz_id, arr);
        }
        const assignmentByAssignment = new Map<
            number,
            Array<{ status: WebinarAssignmentHistoryStatus; grade: number | null; created_at: number }>
        >();
        for (const a of assignmentHistories) {
            const arr = assignmentByAssignment.get(a.assignment_id) ?? [];
            arr.push({ status: a.status, grade: a.grade ?? null, created_at: Number(a.created_at) });
            assignmentByAssignment.set(a.assignment_id, arr);
        }

        const dtoChapters: ProgressChapterDto[] = chapters.map((c) => ({
            id: c.id,
            title: c.title,
            items: c.items.map((item) => {
                const status = this.computeUserStatus(item, {
                    learningByFile,
                    quizByQuiz,
                    assignmentByAssignment,
                });
                return {
                    id: item.id,
                    type: item.type,
                    item_id: item.item_id,
                    title: titleMaps.get(item.id) ?? `#${item.item_id}`,
                    is_required: item.is_required,
                    user_status: status,
                    group_completion: null,
                };
            }),
        }));

        const aggregate = this.computeUserAggregate(dtoChapters);
        const last_activity = this.computeLastActivity(learnings, quizResults, assignmentHistories);

        return { target, chapters: dtoChapters, aggregate, last_activity };
    }

    private computeUserStatus(
        item: ItemWithType,
        idx: {
            learningByFile: Map<number, number>;
            quizByQuiz: Map<
                number,
                Array<{ status: QuizResultStatus; user_grade: number | null; created_at: number }>
            >;
            assignmentByAssignment: Map<
                number,
                Array<{ status: WebinarAssignmentHistoryStatus; grade: number | null; created_at: number }>
            >;
        },
    ): ProgressUserStatusDto {
        if (item.type === 'quiz') {
            const attempts = idx.quizByQuiz.get(item.item_id) ?? [];
            if (attempts.length === 0) {
                return { status: 'not_started', score: null, grade: null, last_at: null, attempts: 0 };
            }
            const hasPassed = attempts.some((a) => a.status === QuizResultStatus.passed);
            const bestScore = attempts.reduce<number | null>(
                (m, a) => (a.user_grade !== null && (m === null || a.user_grade > m) ? a.user_grade : m),
                null,
            );
            const status: ProgressUserStatusDto['status'] = hasPassed
                ? 'passed'
                : attempts[0].status === QuizResultStatus.waiting
                  ? 'pending'
                  : 'failed';
            return {
                status,
                score: bestScore,
                grade: null,
                last_at: attempts[0].created_at,
                attempts: attempts.length,
            };
        }
        if (item.type === 'assignment') {
            const attempts = idx.assignmentByAssignment.get(item.item_id) ?? [];
            if (attempts.length === 0) {
                return { status: 'not_submitted', score: null, grade: null, last_at: null, attempts: 0 };
            }
            const hasPassed = attempts.some((a) => a.status === WebinarAssignmentHistoryStatus.passed);
            const hasFailed = attempts.some((a) => a.status === WebinarAssignmentHistoryStatus.not_passed);
            const status: ProgressUserStatusDto['status'] = hasPassed
                ? 'passed'
                : hasFailed
                  ? 'failed'
                  : 'pending';
            const latestGrade = attempts.find((a) => a.grade !== null)?.grade ?? null;
            return {
                status,
                score: null,
                grade: latestGrade,
                last_at: attempts[0].created_at,
                attempts: attempts.length,
            };
        }
        // file / session / text_lesson — CourseLearning row presence == viewed.
        const ts = idx.learningByFile.get(item.item_id) ?? null;
        return {
            status: ts === null ? 'not_started' : 'viewed',
            score: null,
            grade: null,
            last_at: ts,
            attempts: null,
        };
    }

    private computeUserAggregate(chapters: ProgressChapterDto[]): ProgressAggregateDto {
        let total = 0;
        let done = 0;
        for (const ch of chapters) {
            for (const item of ch.items) {
                if (!item.is_required) continue;
                total += 1;
                const s = item.user_status?.status;
                if (s === 'viewed' || s === 'passed') done += 1;
            }
        }
        const percent = total === 0 ? 0 : Math.round((done / total) * 100) / 100;
        return { done, total, percent };
    }

    private computeLastActivity(
        learnings: Array<{ created_at: number }>,
        quizResults: Array<{ created_at: number }>,
        assignmentHistories: Array<{ created_at: bigint }>,
    ): number | null {
        let max: number | null = null;
        const bump = (ts: number) => {
            if (max === null || ts > max) max = ts;
        };
        for (const l of learnings) bump(l.created_at);
        for (const q of quizResults) bump(q.created_at);
        for (const a of assignmentHistories) bump(Number(a.created_at));
        return max;
    }

    // -----------------------------------------------------------------------
    // Per-group
    // -----------------------------------------------------------------------

    private async buildGroupReport(
        courseId: number,
        groupId: number,
        chapters: ChapterWithItems[],
        buckets: ItemBuckets,
        target: ProgressTargetSummaryDto,
    ): Promise<ProgressReportDto> {
        const members = await this.prisma.groupUser.findMany({
            where: { group_id: groupId },
            select: { user_id: true },
        });
        const memberIds = members.map((m) => m.user_id);
        const totalMembers = memberIds.length;
        target.members_count = totalMembers;

        // For empty groups: return zeroed report with titles only.
        if (totalMembers === 0) {
            const titleMaps = await this.loadItemTitles(buckets);
            return {
                target,
                chapters: chapters.map((c) => ({
                    id: c.id,
                    title: c.title,
                    items: c.items.map((item) => ({
                        id: item.id,
                        type: item.type,
                        item_id: item.item_id,
                        title: titleMaps.get(item.id) ?? `#${item.item_id}`,
                        is_required: item.is_required,
                        user_status: null,
                        group_completion: { done: 0, total: 0, ratio: 0 },
                    })),
                })),
                aggregate: { done: 0, total: 0, percent: 0 },
                last_activity: null,
            };
        }

        // Batch fetch all rows; group in JS so we can count DISTINCT users per
        // item (Prisma groupBy doesn't do COUNT DISTINCT cleanly).
        const [learnings, quizResults, assignmentHistories, titleMaps] = await Promise.all([
            buckets.fileIds.length > 0
                ? this.prisma.courseLearning.findMany({
                      where: { user_id: { in: memberIds }, file_id: { in: buckets.fileIds } },
                      select: { user_id: true, file_id: true, created_at: true },
                  })
                : Promise.resolve(
                      [] as Array<{ user_id: number; file_id: number; created_at: number }>,
                  ),
            buckets.quizIds.length > 0
                ? this.prisma.quizResult.findMany({
                      where: {
                          user_id: { in: memberIds },
                          quiz_id: { in: buckets.quizIds },
                          status: QuizResultStatus.passed,
                      },
                      select: { user_id: true, quiz_id: true, created_at: true },
                  })
                : Promise.resolve(
                      [] as Array<{ user_id: number; quiz_id: number; created_at: number }>,
                  ),
            buckets.assignmentIds.length > 0
                ? this.prisma.webinarAssignmentHistory.findMany({
                      where: {
                          student_id: { in: memberIds },
                          assignment_id: { in: buckets.assignmentIds },
                          status: WebinarAssignmentHistoryStatus.passed,
                      },
                      select: { student_id: true, assignment_id: true, created_at: true },
                  })
                : Promise.resolve(
                      [] as Array<{ student_id: number; assignment_id: number; created_at: bigint }>,
                  ),
            this.loadItemTitles(buckets),
        ]);

        // For each (file_id | quiz_id | assignment_id) count distinct member-ids.
        const fileDone = new Map<number, Set<number>>();
        for (const l of learnings) {
            const s = fileDone.get(l.file_id) ?? new Set<number>();
            s.add(l.user_id);
            fileDone.set(l.file_id, s);
        }
        const quizDone = new Map<number, Set<number>>();
        for (const q of quizResults) {
            const s = quizDone.get(q.quiz_id) ?? new Set<number>();
            s.add(q.user_id);
            quizDone.set(q.quiz_id, s);
        }
        const assignmentDone = new Map<number, Set<number>>();
        for (const a of assignmentHistories) {
            const s = assignmentDone.get(a.assignment_id) ?? new Set<number>();
            s.add(a.student_id);
            assignmentDone.set(a.assignment_id, s);
        }

        const dtoChapters: ProgressChapterDto[] = chapters.map((c) => ({
            id: c.id,
            title: c.title,
            items: c.items.map((item) => {
                const completion = this.computeGroupCompletion(item, totalMembers, {
                    fileDone,
                    quizDone,
                    assignmentDone,
                });
                return {
                    id: item.id,
                    type: item.type,
                    item_id: item.item_id,
                    title: titleMaps.get(item.id) ?? `#${item.item_id}`,
                    is_required: item.is_required,
                    user_status: null,
                    group_completion: completion,
                };
            }),
        }));

        const aggregate = this.computeGroupAggregate(dtoChapters, totalMembers);
        const last_activity = this.computeLastActivity(learnings, quizResults, assignmentHistories);

        return { target, chapters: dtoChapters, aggregate, last_activity };
    }

    private computeGroupCompletion(
        item: ItemWithType,
        totalMembers: number,
        idx: {
            fileDone: Map<number, Set<number>>;
            quizDone: Map<number, Set<number>>;
            assignmentDone: Map<number, Set<number>>;
        },
    ): ProgressGroupCompletionDto {
        let done = 0;
        if (item.type === 'quiz') done = idx.quizDone.get(item.item_id)?.size ?? 0;
        else if (item.type === 'assignment') done = idx.assignmentDone.get(item.item_id)?.size ?? 0;
        else done = idx.fileDone.get(item.item_id)?.size ?? 0;
        const ratio = totalMembers === 0 ? 0 : Math.round((done / totalMembers) * 100) / 100;
        return { done, total: totalMembers, ratio };
    }

    private computeGroupAggregate(
        chapters: ProgressChapterDto[],
        totalMembers: number,
    ): ProgressAggregateDto {
        let total = 0;
        let done = 0;
        for (const ch of chapters) {
            for (const item of ch.items) {
                if (!item.is_required) continue;
                total += totalMembers;
                done += item.group_completion?.done ?? 0;
            }
        }
        const percent = total === 0 ? 0 : Math.round((done / total) * 100) / 100;
        return { done, total, percent };
    }

    // -----------------------------------------------------------------------
    // Shared helpers
    // -----------------------------------------------------------------------

    private async fetchChaptersWithItems(courseId: number): Promise<ChapterWithItems[]> {
        const chapters = await this.prisma.webinarChapter.findMany({
            where: { webinar_id: courseId },
            orderBy: { order: 'asc' },
            select: {
                id: true,
                translations: { where: { locale: 'kz' }, select: { title: true }, take: 1 },
                items: {
                    orderBy: { order: 'asc' },
                    select: {
                        id: true,
                        type: true,
                        item_id: true,
                        is_required: true,
                    },
                },
            },
        });
        return chapters.map((c) => ({
            id: c.id,
            title: c.translations[0]?.title ?? `#${c.id}`,
            items: c.items.map((i) => ({
                id: i.id,
                type: String(i.type),
                item_id: i.item_id,
                is_required: i.is_required,
            })),
        }));
    }

    private bucketItems(chapters: ChapterWithItems[]): ItemBuckets {
        const fileIds: number[] = [];
        const quizIds: number[] = [];
        const assignmentIds: number[] = [];
        for (const c of chapters) {
            for (const item of c.items) {
                if (item.type === 'quiz') quizIds.push(item.item_id);
                else if (item.type === 'assignment') assignmentIds.push(item.item_id);
                else fileIds.push(item.item_id);
            }
        }
        return { fileIds, quizIds, assignmentIds };
    }

    /** Load KZ titles for every file/quiz/assignment referenced by the buckets. */
    private async loadItemTitles(buckets: ItemBuckets): Promise<Map<number, string>> {
        const [files, quizzes, assignments] = await Promise.all([
            buckets.fileIds.length > 0
                ? this.prisma.files.findMany({
                      where: { id: { in: buckets.fileIds } },
                      select: {
                          id: true,
                          file: true,
                          translations: { where: { locale: 'kz' }, select: { title: true }, take: 1 },
                      },
                  })
                : Promise.resolve(
                      [] as Array<{
                          id: number;
                          file: string;
                          translations: { title: string }[];
                      }>,
                  ),
            buckets.quizIds.length > 0
                ? this.prisma.quizzes.findMany({
                      where: { id: { in: buckets.quizIds } },
                      select: {
                          id: true,
                          translations: { where: { locale: 'kz' }, select: { title: true }, take: 1 },
                      },
                  })
                : Promise.resolve(
                      [] as Array<{ id: number; translations: { title: string }[] }>,
                  ),
            buckets.assignmentIds.length > 0
                ? this.prisma.webinarAssignment.findMany({
                      where: { id: { in: buckets.assignmentIds } },
                      select: {
                          id: true,
                          translations: { where: { locale: 'kz' }, select: { title: true }, take: 1 },
                      },
                  })
                : Promise.resolve(
                      [] as Array<{ id: number; translations: { title: string }[] }>,
                  ),
        ]);

        // Map back to item.id via re-fetch is overkill — instead build by item_id+type
        // and resolve at call-site via a small map: itemKey = `${type}:${item_id}`.
        // To return Map<chapterItemId, title> we need the items list; easier to
        // build a map keyed by `${type}:${item_id}` and let callers re-bind.
        // But the call-site uses chapter items list, so we'll do final bind here.
        const byType = {
            file: new Map<number, string>(
                files.map((f): [number, string] => [f.id, f.translations[0]?.title ?? f.file ?? `#${f.id}`]),
            ),
            quiz: new Map<number, string>(
                quizzes.map((q): [number, string] => [q.id, q.translations[0]?.title ?? `#${q.id}`]),
            ),
            assignment: new Map<number, string>(
                assignments.map((a): [number, string] => [a.id, a.translations[0]?.title ?? `#${a.id}`]),
            ),
        };

        // Walk chapters again to bind chapterItem.id → title. Caller has chapters
        // in scope, but to keep this helper self-contained we read them again.
        const itemRows = await this.prisma.webinarChapterItem.findMany({
            where: {
                OR: [
                    { type: 'file', item_id: { in: buckets.fileIds } },
                    { type: 'quiz', item_id: { in: buckets.quizIds } },
                    { type: 'assignment', item_id: { in: buckets.assignmentIds } },
                ],
            },
            select: { id: true, type: true, item_id: true },
        });
        const out = new Map<number, string>();
        for (const i of itemRows) {
            const t = String(i.type) as 'file' | 'quiz' | 'assignment';
            const title = byType[t]?.get(i.item_id) ?? `#${i.item_id}`;
            out.set(i.id, title);
        }
        return out;
    }

    private async resolveTarget(query: ProgressReportQueryDto): Promise<ProgressTargetSummaryDto> {
        if (query.target_kind === 'user') {
            const u = await this.prisma.user.findUnique({
                where: { id: query.target_id },
                select: { id: true, full_name: true, email: true },
            });
            if (!u) throw new NotFoundException('courses_progress.target_not_found');
            return {
                kind: 'user',
                target_id: u.id,
                label: u.full_name ?? u.email ?? `#${u.id}`,
                members_count: null,
            };
        }
        const g = await this.prisma.group.findUnique({
            where: { id: query.target_id },
            select: { id: true, name: true },
        });
        if (!g) throw new NotFoundException('courses_progress.target_not_found');
        return { kind: 'group', target_id: g.id, label: g.name, members_count: null };
    }
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface ItemWithType {
    id: number;
    type: string;
    item_id: number;
    is_required: boolean;
}

interface ChapterWithItems {
    id: number;
    title: string;
    items: ItemWithType[];
}

interface ItemBuckets {
    fileIds: number[];
    quizIds: number[];
    assignmentIds: number[];
}
