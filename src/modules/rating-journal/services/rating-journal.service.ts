import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { apiResponse } from '../../../common/utils/api-response';
import { buildScopeWhere } from '../../../common/scoping/scope.helper';
import type { ScopeActor } from '../../../common/scoping/scope.types';
import type { Prisma, UserStatus } from '../../../../generated/prisma';
import { CreateJournalDto } from '../dto/create-journal.dto';
import { GridQueryDto } from '../dto/grid-query.dto';
import { ListJournalsDto } from '../dto/list-journals.dto';
import { RATING_JOURNAL_SCOPE_RULES } from '../rating-journal.scope';
import type { JournalColumnDto, JournalGridDto, JournalRowDto } from '../types/rating-journal.types';
import { RatingJournalSyncService } from './rating-journal-sync.service';
import { RatingJournalWriterService } from './rating-journal-writer.service';

interface JournalRef {
    id: bigint;
    group_id: number;
    course_id: number;
    title: string;
}

/**
 * «Рейтинг-журнал» read/create surface. Rows derive from group membership at
 * read time (no per-student row table). The grid auto-syncs module columns on
 * open (best-effort) so grades stay fresh without an explicit refresh.
 */
@Injectable()
export class RatingJournalService {
    private readonly logger = new Logger(RatingJournalService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly writer: RatingJournalWriterService,
        private readonly sync: RatingJournalSyncService,
    ) {}

    /**
     * Authorize access to a group's journal surface: admin → all; curator → only
     * groups they supervise; teacher/other → denied. Returns the group.
     */
    public async assertGroupAccess(actor: ScopeActor, groupId: number): Promise<{ id: number; supervisor_id: number | null }> {
        const group = await this.prisma.group.findUnique({ where: { id: groupId }, select: { id: true, supervisor_id: true } });
        if (!group) throw new NotFoundException({ code: 'rating_journal.group_not_found', message: 'rating_journal.group_not_found' });
        if (actor.role_name === 'admin') return group;
        if (actor.role_name === 'curator' && group.supervisor_id === actor.id) return group;
        throw new ForbiddenException({ code: 'rating_journal.group_forbidden', message: 'rating_journal.group_forbidden' });
    }

    /** Load a journal by id and authorize the actor against its group. */
    public async resolveJournalForActor(actor: ScopeActor, journalId: bigint): Promise<JournalRef> {
        const journal = await this.prisma.ratingJournal.findFirst({
            where: { id: journalId, deleted_at: null },
            select: { id: true, group_id: true, course_id: true, title: true },
        });
        if (!journal) throw new NotFoundException({ code: 'rating_journal.not_found', message: 'rating_journal.not_found' });
        await this.assertGroupAccess(actor, journal.group_id);
        return journal;
    }

    public async getGrid(actor: ScopeActor, query: GridQueryDto) {
        await this.assertGroupAccess(actor, query.group_id);
        await this.assertCourseExists(query.course_id);

        const journal = await this.writer.resolveOrCreateJournal(query.group_id, query.course_id, actor.id);

        try {
            await this.sync.sync(journal.id, journal.course_id, journal.group_id, actor.id);
        } catch (err) {
            this.logger.warn(`grid auto-sync failed journal=${journal.id.toString()}: ${(err as Error)?.message}`);
        }

        const grid = await this.buildGrid(journal, { dateFrom: query.date_from, dateTo: query.date_to });
        return grid; // raw shape — TanStack consumes it directly
    }

    /** Explicit «синхронизировать» — pull module grades then return the fresh grid. */
    public async syncJournal(actor: ScopeActor, journalId: bigint) {
        const journal = await this.resolveJournalForActor(actor, journalId);
        try {
            await this.sync.sync(journal.id, journal.course_id, journal.group_id, actor.id);
        } catch (err) {
            this.logger.warn(`manual sync failed journal=${journal.id.toString()}: ${(err as Error)?.message}`);
        }
        return this.buildGrid(journal);
    }

    public async createJournal(actor: ScopeActor, dto: CreateJournalDto) {
        await this.assertGroupAccess(actor, dto.group_id);
        await this.assertCourseExists(dto.course_id);
        const journal = await this.writer.resolveOrCreateJournal(dto.group_id, dto.course_id, actor.id);
        if (dto.title && dto.title.trim()) {
            await this.prisma.ratingJournal.update({ where: { id: journal.id }, data: { title: dto.title.trim() } });
            journal.title = dto.title.trim();
        }
        return apiResponse(1, 'created', 'admin.rating_journal.created', {
            id: journal.id.toString(),
            group_id: journal.group_id,
            course_id: journal.course_id,
            title: journal.title,
        });
    }

    public async listJournals(actor: ScopeActor, query: ListJournalsDto) {
        const page = query.page ?? 1;
        const pageSize = query.page_size ?? 50;
        const where: Prisma.RatingJournalWhereInput = {
            deleted_at: null,
            ...(query.group_id ? { group_id: query.group_id } : {}),
            ...(query.course_id ? { course_id: query.course_id } : {}),
            ...(buildScopeWhere(actor, RATING_JOURNAL_SCOPE_RULES) as Prisma.RatingJournalWhereInput),
        };
        const [rows, total] = await Promise.all([
            this.prisma.ratingJournal.findMany({
                where,
                orderBy: [{ id: 'desc' }],
                skip: (page - 1) * pageSize,
                take: pageSize,
                select: { id: true, group_id: true, course_id: true, title: true, created_at: true },
            }),
            this.prisma.ratingJournal.count({ where }),
        ]);
        return {
            rows: rows.map((r) => ({ ...r, id: r.id.toString() })),
            total,
            pageCount: Math.max(1, Math.ceil(total / pageSize)),
        };
    }

    private async assertCourseExists(courseId: number): Promise<void> {
        const course = await this.prisma.webinar.findFirst({ where: { id: courseId, deleted_at: null }, select: { id: true } });
        if (!course) throw new NotFoundException({ code: 'rating_journal.course_not_found', message: 'rating_journal.course_not_found' });
    }

    private async buildGrid(
        journal: JournalRef,
        dateRange: { dateFrom?: number; dateTo?: number } = {},
    ): Promise<JournalGridDto> {
        const columnRows = await this.prisma.ratingJournalColumn.findMany({
            where: { journal_id: journal.id, deleted_at: null },
            orderBy: [{ position: 'asc' }, { id: 'asc' }],
            select: {
                id: true,
                title: true,
                source_kind: true,
                source_ref_id: true,
                chapter_id: true,
                max_score: true,
                position: true,
                is_hidden: true,
            },
        });

        const columns: JournalColumnDto[] = columnRows.map((c) => ({
            id: c.id.toString(),
            title: c.title,
            source_kind: c.source_kind,
            source_ref_id: c.source_ref_id == null ? null : c.source_ref_id.toString(),
            chapter_id: c.chapter_id,
            max_score: c.max_score,
            position: c.position,
            is_hidden: c.is_hidden,
            is_auto: c.source_ref_id !== null, // module/credit columns carry a source ref
            is_custom: c.source_kind === 'custom',
        }));

        const students = await this.groupStudents(journal.group_id);
        const columnIds = columnRows.map((c) => c.id);

        const cellRows = columnIds.length
            ? await this.prisma.ratingJournalCell.findMany({
                  where: { column_id: { in: columnIds } },
                  select: { column_id: true, student_id: true, value: true, is_manual_override: true },
              })
            : [];
        const cellsByStudent = new Map<number, Map<string, { value: number | null; is_manual_override: boolean }>>();
        for (const cell of cellRows) {
            const key = cell.column_id.toString();
            const perStudent = cellsByStudent.get(cell.student_id) ?? new Map();
            perStudent.set(key, { value: cell.value, is_manual_override: cell.is_manual_override });
            cellsByStudent.set(cell.student_id, perStudent);
        }

        // Calendar filter (item 5): keep only cells graded/edited within the range,
        // per the append-only edit log (changed_at). Null = no filter → all cells.
        const inRange = await this.cellsGradedInRange(columnIds, dateRange);

        const visibleColumnIds = new Set(columns.filter((c) => !c.is_hidden).map((c) => c.id));
        const maxTotal = columns.filter((c) => !c.is_hidden).reduce((s, c) => s + c.max_score, 0);

        const rows: JournalRowDto[] = students.map((student) => {
            const perStudent = cellsByStudent.get(student.id);
            const cells: JournalRowDto['cells'] = {};
            let total = 0;
            for (const col of columns) {
                const cell = perStudent?.get(col.id);
                if (!cell) continue;
                // When a date range is active, skip cells not graded within it.
                if (inRange && !inRange.has(`${col.id}:${student.id}`)) continue;
                cells[col.id] = { column_id: col.id, value: cell.value, is_manual_override: cell.is_manual_override };
                if (cell.value != null && visibleColumnIds.has(col.id)) total += cell.value;
            }
            return { student_id: student.id, full_name: student.full_name, status: student.status, cells, total };
        });

        return {
            journal: { id: journal.id.toString(), group_id: journal.group_id, course_id: journal.course_id, title: journal.title },
            columns,
            rows,
            max_total: maxTotal,
        };
    }

    /**
     * (column_id:student_id) keys of cells whose grade was entered/edited within
     * the [dateFrom, dateTo] range (inclusive), via the append-only edit log. Returns
     * null when no date bound is set (→ caller shows all cells).
     */
    private async cellsGradedInRange(
        columnIds: bigint[],
        range: { dateFrom?: number; dateTo?: number },
    ): Promise<Set<string> | null> {
        if (range.dateFrom == null && range.dateTo == null) return null;
        const set = new Set<string>();
        if (columnIds.length === 0) return set;
        const history = await this.prisma.ratingJournalCellHistory.findMany({
            where: {
                column_id: { in: columnIds },
                changed_at: {
                    ...(range.dateFrom != null ? { gte: range.dateFrom } : {}),
                    ...(range.dateTo != null ? { lte: range.dateTo } : {}),
                },
            },
            select: { column_id: true, student_id: true },
        });
        for (const h of history) set.add(`${h.column_id.toString()}:${h.student_id}`);
        return set;
    }

    private async groupStudents(groupId: number): Promise<Array<{ id: number; full_name: string | null; status: UserStatus }>> {
        const members = await this.prisma.groupUser.findMany({
            where: { group_id: groupId },
            select: { user_id: true, user: { select: { full_name: true, status: true } } },
        });
        const byId = new Map<number, { full_name: string | null; status: UserStatus }>();
        for (const m of members) {
            // group_users has no unique — de-dup, first membership wins
            if (!byId.has(m.user_id)) byId.set(m.user_id, { full_name: m.user?.full_name ?? null, status: m.user?.status ?? 'active' });
        }
        return Array.from(byId.entries())
            .map(([id, v]) => ({ id, full_name: v.full_name, status: v.status }))
            .sort((a, b) => (a.full_name ?? '').localeCompare(b.full_name ?? '', 'ru') || a.id - b.id);
    }
}
