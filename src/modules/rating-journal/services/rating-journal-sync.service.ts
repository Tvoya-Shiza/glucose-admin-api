import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import type { RatingJournalSourceKind } from '../../../../generated/prisma';
import { RatingJournalWriterService } from './rating-journal-writer.service';

interface ModuleItem {
    sourceKind: RatingJournalSourceKind; // module_quiz | module_assignment
    sourceRefId: number; // quiz_id | webinar_assignment_id
    title: string;
    maxScore: number;
    chapterId: number;
}

/**
 * Auto-pull of module columns (тест → quizzes_results.user_grade best-of;
 * конспект → webinar_assignment_history.grade latest). A poll, not write-through:
 * grades are written by glucose-api, admin-api only reads. Run on grid open and
 * on the explicit «синхронизировать» action. Best-effort — a failure never
 * breaks the grid read (callers wrap in try/catch and log).
 *
 * Manual-override cells are never touched (enforced in RatingJournalWriterService).
 */
@Injectable()
export class RatingJournalSyncService {
    private readonly logger = new Logger(RatingJournalSyncService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly writer: RatingJournalWriterService,
    ) {}

    public async sync(journalId: bigint, courseId: number, groupId: number, actorId: number): Promise<void> {
        const items = await this.collectModuleItems(courseId);
        if (items.length === 0) return;

        // Resolve/create a column per module item.
        const columns = new Map<string, bigint>(); // key `${kind}:${refId}` → column_id
        for (const it of items) {
            const col = await this.writer.resolveOrCreateColumn({
                journalId,
                sourceKind: it.sourceKind,
                sourceRefId: BigInt(it.sourceRefId),
                title: it.title,
                maxScore: it.maxScore,
                chapterId: it.chapterId,
                actorId,
            });
            columns.set(`${it.sourceKind}:${it.sourceRefId}`, col.id);
        }

        const studentIds = await this.groupStudentIds(groupId);
        if (studentIds.length === 0) return;

        const quizIds = items.filter((i) => i.sourceKind === 'module_quiz').map((i) => i.sourceRefId);
        const assignmentIds = items.filter((i) => i.sourceKind === 'module_assignment').map((i) => i.sourceRefId);

        const [quizGrades, assignmentGrades, existingCells] = await Promise.all([
            this.bestQuizGrades(quizIds, studentIds),
            this.latestAssignmentGrades(assignmentIds, studentIds),
            this.existingCellsFor(Array.from(columns.values())),
        ]);

        for (const it of items) {
            const columnId = columns.get(`${it.sourceKind}:${it.sourceRefId}`);
            if (columnId == null) continue;
            const gradeMap = it.sourceKind === 'module_quiz' ? quizGrades : assignmentGrades;

            for (const studentId of studentIds) {
                const grade = gradeMap.get(`${it.sourceRefId}:${studentId}`);
                if (grade == null) continue; // no submission yet — leave the cell ungraded

                const existing = existingCells.get(`${columnId.toString()}:${studentId}`);
                if (existing?.is_manual_override) continue; // curator edit — never clobber
                if (existing && existing.value === grade) continue; // unchanged

                await this.writer.writeAutoCell(columnId, studentId, grade, null, 'sync_module');
            }
        }
    }

    /** Quiz + assignment gradeable items across the course's module tree. */
    private async collectModuleItems(courseId: number): Promise<ModuleItem[]> {
        const chapterItems = await this.prisma.webinarChapterItem.findMany({
            where: { webinar_chapter: { webinar_id: courseId }, type: { in: ['quiz', 'assignment'] } },
            select: { item_id: true, chapter_id: true, type: true, order: true },
            orderBy: [{ chapter_id: 'asc' }, { order: 'asc' }],
        });
        if (chapterItems.length === 0) return [];

        const quizIds = chapterItems.filter((i) => i.type === 'quiz').map((i) => i.item_id);
        const assignmentIds = chapterItems.filter((i) => i.type === 'assignment').map((i) => i.item_id);

        // Always query — an empty `in: []` returns [] (no widening to never[]).
        const [quizzes, quizTitles, assignments, assignmentTitles] = await Promise.all([
            this.prisma.quizzes.findMany({ where: { id: { in: quizIds } }, select: { id: true, total_mark: true } }),
            this.prisma.quizTranslation.findMany({ where: { quiz_id: { in: quizIds } }, select: { quiz_id: true, locale: true, title: true } }),
            this.prisma.webinarAssignment.findMany({ where: { id: { in: assignmentIds } }, select: { id: true, grade: true } }),
            this.prisma.webinarAssignmentTranslation.findMany({
                where: { webinar_assignment_id: { in: assignmentIds } },
                select: { webinar_assignment_id: true, locale: true, title: true },
            }),
        ]);

        const quizMax = new Map<number, number>(quizzes.map((q) => [q.id, q.total_mark ?? 0]));
        const assignmentMax = new Map<number, number>(assignments.map((a) => [a.id, a.grade ?? 0]));
        const quizTitle = this.titleMap(quizTitles.map((t) => ({ id: t.quiz_id, locale: t.locale, title: t.title })));
        const assignmentTitle = this.titleMap(
            assignmentTitles.map((t) => ({ id: t.webinar_assignment_id, locale: t.locale, title: t.title })),
        );

        const items: ModuleItem[] = [];
        for (const ci of chapterItems) {
            if (ci.type === 'quiz') {
                items.push({
                    sourceKind: 'module_quiz',
                    sourceRefId: ci.item_id,
                    title: quizTitle.get(ci.item_id) ?? `Тест #${ci.item_id}`,
                    maxScore: quizMax.get(ci.item_id) ?? 0,
                    chapterId: ci.chapter_id,
                });
            } else if (ci.type === 'assignment') {
                items.push({
                    sourceKind: 'module_assignment',
                    sourceRefId: ci.item_id,
                    title: assignmentTitle.get(ci.item_id) ?? `Конспект #${ci.item_id}`,
                    maxScore: assignmentMax.get(ci.item_id) ?? 0,
                    chapterId: ci.chapter_id,
                });
            }
        }
        return items;
    }

    private titleMap(rows: Array<{ id: number; locale: string; title: string }>): Map<number, string> {
        const byId = new Map<number, { ru?: string; kk?: string; any?: string }>();
        for (const r of rows) {
            const e = byId.get(r.id) ?? {};
            if (r.locale === 'ru') e.ru = r.title;
            else if (r.locale === 'kk') e.kk = r.title;
            e.any = e.any ?? r.title;
            byId.set(r.id, e);
        }
        const out = new Map<number, string>();
        for (const [id, e] of byId) {
            const t = (e.ru ?? e.kk ?? e.any ?? '').trim();
            if (t) out.set(id, t);
        }
        return out;
    }

    private async groupStudentIds(groupId: number): Promise<number[]> {
        const rows = await this.prisma.groupUser.findMany({ where: { group_id: groupId }, select: { user_id: true } });
        return Array.from(new Set(rows.map((r) => r.user_id))); // group_users has no unique (user_id, group_id) — de-dup
    }

    private async bestQuizGrades(quizIds: number[], studentIds: number[]): Promise<Map<string, number>> {
        const map = new Map<string, number>();
        if (quizIds.length === 0) return map;
        const rows = await this.prisma.quizResult.findMany({
            where: { quiz_id: { in: quizIds }, user_id: { in: studentIds } },
            select: { quiz_id: true, user_id: true, user_grade: true },
        });
        for (const r of rows) {
            if (r.user_grade == null) continue;
            const key = `${r.quiz_id}:${r.user_id}`;
            const prev = map.get(key);
            if (prev == null || r.user_grade > prev) map.set(key, r.user_grade);
        }
        return map;
    }

    private async latestAssignmentGrades(assignmentIds: number[], studentIds: number[]): Promise<Map<string, number>> {
        const map = new Map<string, { grade: number; at: bigint }>();
        if (assignmentIds.length === 0) return new Map();
        const rows = await this.prisma.webinarAssignmentHistory.findMany({
            where: { assignment_id: { in: assignmentIds }, student_id: { in: studentIds }, grade: { not: null } },
            select: { assignment_id: true, student_id: true, grade: true, created_at: true },
        });
        for (const r of rows) {
            if (r.grade == null) continue;
            const key = `${r.assignment_id}:${r.student_id}`;
            const prev = map.get(key);
            if (prev == null || r.created_at > prev.at) map.set(key, { grade: r.grade, at: r.created_at });
        }
        const out = new Map<string, number>();
        for (const [k, v] of map) out.set(k, v.grade);
        return out;
    }

    private async existingCellsFor(
        columnIds: bigint[],
    ): Promise<Map<string, { value: number | null; is_manual_override: boolean }>> {
        const map = new Map<string, { value: number | null; is_manual_override: boolean }>();
        if (columnIds.length === 0) return map;
        const rows = await this.prisma.ratingJournalCell.findMany({
            where: { column_id: { in: columnIds } },
            select: { column_id: true, student_id: true, value: true, is_manual_override: true },
        });
        for (const r of rows) {
            map.set(`${r.column_id.toString()}:${r.student_id}`, { value: r.value, is_manual_override: r.is_manual_override });
        }
        return map;
    }
}
