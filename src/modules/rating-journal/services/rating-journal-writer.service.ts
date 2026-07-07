import { Injectable, Logger } from '@nestjs/common';
import type { CreditJournalEntry } from '@shared/credits';
import { PrismaService } from '../../../prisma/prisma.service';
import type { RatingJournalCellSource, RatingJournalSourceKind } from '../../../../generated/prisma';
import { nowSec } from '../utils/time';

const FINALIZED_STATUSES = ['finished', 'expired'] as const;

interface ResolvedJournal {
    id: bigint;
    group_id: number;
    course_id: number;
    title: string;
}

interface ResolvedColumn {
    id: bigint;
    source_kind: RatingJournalSourceKind;
    source_ref_id: bigint | null;
    max_score: number;
}

/**
 * Low-level rating-journal write primitives, shared by:
 *   - RatingJournalCreditAdapter (the «Зачёт» finalize hook)
 *   - RatingJournalSyncService   (module-grade auto-pull)
 *   - RatingJournalCellsService  (reset-to-auto)
 *
 * All cell writes go through writeAutoCell so the manual-override rule
 * (sync must never clobber a curator edit) and the append-only edit log
 * (кто/когда/было→стало) are enforced in exactly one place.
 */
@Injectable()
export class RatingJournalWriterService {
    private readonly logger = new Logger(RatingJournalWriterService.name);

    constructor(private readonly prisma: PrismaService) {}

    /** Find the (group, course) journal, creating it lazily on first write. */
    public async resolveOrCreateJournal(groupId: number, courseId: number, actorId: number): Promise<ResolvedJournal> {
        const existing = await this.prisma.ratingJournal.findFirst({
            where: { group_id: groupId, course_id: courseId, deleted_at: null },
            select: { id: true, group_id: true, course_id: true, title: true },
        });
        if (existing) return existing;

        const title = await this.resolveCourseTitle(courseId);
        try {
            const created = await this.prisma.ratingJournal.create({
                data: { group_id: groupId, course_id: courseId, title, created_by: actorId, created_at: nowSec() },
                select: { id: true, group_id: true, course_id: true, title: true },
            });
            return created;
        } catch (err) {
            // Lost the create race on uniq_rj_group_course (P2002) — re-read the winner.
            if ((err as { code?: string })?.code === 'P2002') {
                const winner = await this.prisma.ratingJournal.findFirst({
                    where: { group_id: groupId, course_id: courseId },
                    select: { id: true, group_id: true, course_id: true, title: true },
                });
                if (winner) return winner;
            }
            throw err;
        }
    }

    private async resolveCourseTitle(courseId: number): Promise<string> {
        const translations = await this.prisma.webinarTranslations.findMany({
            where: { webinar_id: courseId },
            select: { locale: true, title: true },
        });
        const pick = translations.find((t) => t.locale === 'ru') ?? translations.find((t) => t.locale === 'kk') ?? translations[0];
        return pick?.title?.trim() || `Рейтинг-журнал #${courseId}`;
    }

    /**
     * Find (or create) an auto-managed column keyed by (journal, source_kind,
     * source_ref_id). Title/max are set on creation and NOT overwritten after —
     * a curator's change-max survives re-sync.
     */
    public async resolveOrCreateColumn(params: {
        journalId: bigint;
        sourceKind: RatingJournalSourceKind;
        sourceRefId: bigint;
        title: string;
        maxScore: number;
        chapterId: number | null;
        actorId: number;
    }): Promise<ResolvedColumn> {
        const existing = await this.prisma.ratingJournalColumn.findFirst({
            where: { journal_id: params.journalId, source_kind: params.sourceKind, source_ref_id: params.sourceRefId },
            select: { id: true, source_kind: true, source_ref_id: true, max_score: true },
        });
        if (existing) return existing;

        const tail = await this.prisma.ratingJournalColumn.aggregate({
            where: { journal_id: params.journalId },
            _max: { position: true },
        });
        const position = (tail._max.position ?? -1) + 1;

        try {
            const created = await this.prisma.ratingJournalColumn.create({
                data: {
                    journal_id: params.journalId,
                    title: params.title.trim() || 'Баған',
                    source_kind: params.sourceKind,
                    source_ref_id: params.sourceRefId,
                    chapter_id: params.chapterId,
                    max_score: params.maxScore,
                    position,
                    created_by: params.actorId,
                    created_at: nowSec(),
                },
                select: { id: true, source_kind: true, source_ref_id: true, max_score: true },
            });
            return created;
        } catch (err) {
            if ((err as { code?: string })?.code === 'P2002') {
                const winner = await this.prisma.ratingJournalColumn.findFirst({
                    where: { journal_id: params.journalId, source_kind: params.sourceKind, source_ref_id: params.sourceRefId },
                    select: { id: true, source_kind: true, source_ref_id: true, max_score: true },
                });
                if (winner) return winner;
            }
            throw err;
        }
    }

    /**
     * Upsert one auto-derived cell + append an edit-log row when the value
     * actually changes. Skips cells a curator has overridden unless force=true
     * (the reset-to-auto path). Idempotent: an unchanged (value, source_session)
     * pair is a no-op, so a crash-retry of the credit adapter writes nothing.
     */
    public async writeAutoCell(
        columnId: bigint,
        studentId: number,
        value: number | null,
        sourceSessionId: bigint | null,
        source: RatingJournalCellSource,
        opts: { force?: boolean; changedBy?: number | null } = {},
    ): Promise<void> {
        const existing = await this.prisma.ratingJournalCell.findUnique({
            where: { uniq_rjcell_col_student: { column_id: columnId, student_id: studentId } },
            select: { id: true, value: true, is_manual_override: true, source_session_id: true },
        });

        if (existing?.is_manual_override && !opts.force) return; // never clobber a curator edit

        const unchanged =
            existing != null &&
            existing.value === value &&
            (existing.source_session_id ?? null) === sourceSessionId &&
            !existing.is_manual_override;
        if (unchanged) return;

        const now = nowSec();
        await this.prisma.$transaction([
            this.prisma.ratingJournalCell.upsert({
                where: { uniq_rjcell_col_student: { column_id: columnId, student_id: studentId } },
                create: {
                    column_id: columnId,
                    student_id: studentId,
                    value,
                    is_manual_override: false,
                    source_session_id: sourceSessionId,
                    updated_by: opts.changedBy ?? null,
                    updated_at: now,
                },
                update: {
                    value,
                    is_manual_override: false,
                    source_session_id: sourceSessionId,
                    updated_by: opts.changedBy ?? null,
                    updated_at: now,
                },
            }),
            this.prisma.ratingJournalCellHistory.create({
                data: {
                    cell_id: existing?.id ?? null,
                    column_id: columnId,
                    student_id: studentId,
                    old_value: existing?.value ?? null,
                    new_value: value,
                    source,
                    changed_by: opts.changedBy ?? null,
                    changed_at: now,
                },
            }),
        ]);
    }

    /**
     * «Зачёт» finalize hook core. Resolves (lazily creating) the journal + the
     * credit's column, then writes the authoritative cell value per the
     * product rule: latest finalized attempt, sticky once passed.
     */
    public async recordCreditResult(entry: CreditJournalEntry): Promise<void> {
        const creditId = BigInt(entry.credit_id);
        const credit = await this.prisma.credit.findUnique({
            where: { id: creditId },
            select: { created_by: true, title: true, chapter_id: true },
        });
        if (!credit) {
            this.logger.warn(`recordCreditResult: credit ${entry.credit_id} not found — skipping`);
            return;
        }

        const journal = await this.resolveOrCreateJournal(entry.group_id, entry.course_id, credit.created_by);
        const column = await this.resolveOrCreateColumn({
            journalId: journal.id,
            sourceKind: 'credit',
            sourceRefId: creditId,
            title: credit.title,
            maxScore: entry.max_score,
            chapterId: credit.chapter_id,
            actorId: credit.created_by,
        });

        const authoritative = await this.computeCreditAuthoritative(creditId, entry.student_id);
        await this.writeAutoCell(column.id, entry.student_id, authoritative.value, authoritative.sessionId, 'sync_credit');
    }

    /**
     * Authoritative «Зачет» value for a (credit, student): the latest finalized
     * attempt's numeric score, but sticky on pass — once the student has a
     * passed attempt, a later fail never downgrades the cell (decision Q2).
     * Both `finished` and `expired` (timeout) attempts count (decision Q4).
     */
    public async computeCreditAuthoritative(
        creditId: bigint,
        studentId: number,
    ): Promise<{ value: number | null; sessionId: bigint | null }> {
        const passed = await this.prisma.creditSession.findFirst({
            where: { credit_id: creditId, student_id: studentId, passed: true, status: { in: [...FINALIZED_STATUSES] } },
            orderBy: [{ attempt_number: 'desc' }],
            select: { id: true, score: true },
        });
        if (passed) return { value: passed.score ?? 0, sessionId: passed.id };

        const latest = await this.prisma.creditSession.findFirst({
            where: { credit_id: creditId, student_id: studentId, status: { in: [...FINALIZED_STATUSES] } },
            orderBy: [{ attempt_number: 'desc' }],
            select: { id: true, score: true },
        });
        if (latest) return { value: latest.score ?? 0, sessionId: latest.id };

        return { value: null, sessionId: null };
    }

    /** Single-cell module grade read, used by the reset-to-auto path. */
    public async readModuleGrade(sourceKind: RatingJournalSourceKind, sourceRefId: bigint, studentId: number): Promise<number | null> {
        if (sourceKind === 'module_quiz') {
            const rows = await this.prisma.quizResult.findMany({
                where: { quiz_id: Number(sourceRefId), user_id: studentId },
                select: { user_grade: true },
            });
            return rows.reduce<number | null>((best, r) => (r.user_grade != null && (best == null || r.user_grade > best) ? r.user_grade : best), null);
        }
        if (sourceKind === 'module_assignment') {
            const latest = await this.prisma.webinarAssignmentHistory.findFirst({
                where: { assignment_id: Number(sourceRefId), student_id: studentId, grade: { not: null } },
                orderBy: [{ created_at: 'desc' }],
                select: { grade: true },
            });
            return latest?.grade ?? null;
        }
        return null;
    }
}
