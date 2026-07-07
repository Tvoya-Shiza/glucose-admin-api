import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { apiResponse } from '../../../common/utils/api-response';
import type { ScopeActor } from '../../../common/scoping/scope.types';
import type { JournalCellHistoryRow } from '../types/rating-journal.types';
import { HistoryQueryDto } from '../dto/history-query.dto';
import { UpsertCellDto } from '../dto/upsert-cell.dto';
import { parseBigIntId } from '../utils/ids';
import { nowSec } from '../utils/time';
import { RatingJournalService } from './rating-journal.service';
import { RatingJournalWriterService } from './rating-journal-writer.service';

/**
 * Inline cell editing (TZ 2.3: autosave, 0..max validation) + reset-to-auto +
 * the edit-log read. A manual edit flips is_manual_override so sync/adapter
 * never clobber it; reset clears the flag and re-derives from the source.
 */
@Injectable()
export class RatingJournalCellsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly journals: RatingJournalService,
        private readonly writer: RatingJournalWriterService,
    ) {}

    public async upsert(actor: ScopeActor, dto: UpsertCellDto) {
        const columnId = parseBigIntId(dto.column_id, 'column_id');
        const column = await this.prisma.ratingJournalColumn.findFirst({
            where: { id: columnId, deleted_at: null },
            select: { id: true, journal_id: true, source_kind: true, source_ref_id: true, max_score: true },
        });
        if (!column) throw new NotFoundException({ code: 'rating_journal.column_not_found', message: 'rating_journal.column_not_found' });

        const journal = await this.journals.resolveJournalForActor(actor, column.journal_id);
        await this.assertMember(journal.group_id, dto.student_id);

        if (dto.reset) {
            await this.resetToAuto(actor, column, dto.student_id);
        } else {
            const value = dto.value ?? null;
            if (value != null && value > column.max_score) {
                throw new BadRequestException({
                    code: 'rating_journal.value_exceeds_max',
                    message: 'rating_journal.value_exceeds_max',
                    max_score: column.max_score,
                });
            }
            await this.writeManualCell(columnId, dto.student_id, value, actor.id);
        }

        const cell = await this.prisma.ratingJournalCell.findUnique({
            where: { uniq_rjcell_col_student: { column_id: columnId, student_id: dto.student_id } },
            select: { column_id: true, student_id: true, value: true, is_manual_override: true },
        });
        return apiResponse(1, 'updated', 'admin.rating_journal.cell_updated', {
            cell: cell
                ? { column_id: cell.column_id.toString(), student_id: cell.student_id, value: cell.value, is_manual_override: cell.is_manual_override }
                : { column_id: columnId.toString(), student_id: dto.student_id, value: null, is_manual_override: false },
        });
    }

    private async resetToAuto(
        actor: ScopeActor,
        column: { id: bigint; source_kind: string; source_ref_id: bigint | null },
        studentId: number,
    ): Promise<void> {
        if (column.source_ref_id === null) {
            // Manual column — no source to re-derive from; clear the value.
            await this.writeAutoClear(column.id, studentId, actor.id);
            return;
        }
        if (column.source_kind === 'credit') {
            const auth = await this.writer.computeCreditAuthoritative(column.source_ref_id, studentId);
            await this.writer.writeAutoCell(column.id, studentId, auth.value, auth.sessionId, 'sync_credit', {
                force: true,
                changedBy: actor.id,
            });
            return;
        }
        // module_quiz | module_assignment
        const grade = await this.writer.readModuleGrade(column.source_kind as never, column.source_ref_id, studentId);
        await this.writer.writeAutoCell(column.id, studentId, grade, null, 'sync_module', { force: true, changedBy: actor.id });
    }

    private async writeAutoClear(columnId: bigint, studentId: number, actorId: number): Promise<void> {
        const existing = await this.prisma.ratingJournalCell.findUnique({
            where: { uniq_rjcell_col_student: { column_id: columnId, student_id: studentId } },
            select: { id: true, value: true },
        });
        const now = nowSec();
        await this.prisma.$transaction([
            this.prisma.ratingJournalCell.upsert({
                where: { uniq_rjcell_col_student: { column_id: columnId, student_id: studentId } },
                create: { column_id: columnId, student_id: studentId, value: null, is_manual_override: false, updated_by: actorId, updated_at: now },
                update: { value: null, is_manual_override: false, source_session_id: null, updated_by: actorId, updated_at: now },
            }),
            this.prisma.ratingJournalCellHistory.create({
                data: {
                    cell_id: existing?.id ?? null,
                    column_id: columnId,
                    student_id: studentId,
                    old_value: existing?.value ?? null,
                    new_value: null,
                    source: 'manual',
                    changed_by: actorId,
                    changed_at: now,
                },
            }),
        ]);
    }

    private async writeManualCell(columnId: bigint, studentId: number, value: number | null, actorId: number): Promise<void> {
        const existing = await this.prisma.ratingJournalCell.findUnique({
            where: { uniq_rjcell_col_student: { column_id: columnId, student_id: studentId } },
            select: { id: true, value: true },
        });
        const now = nowSec();
        await this.prisma.$transaction([
            this.prisma.ratingJournalCell.upsert({
                where: { uniq_rjcell_col_student: { column_id: columnId, student_id: studentId } },
                create: {
                    column_id: columnId,
                    student_id: studentId,
                    value,
                    is_manual_override: true,
                    source_session_id: null,
                    updated_by: actorId,
                    updated_at: now,
                },
                update: { value, is_manual_override: true, source_session_id: null, updated_by: actorId, updated_at: now },
            }),
            this.prisma.ratingJournalCellHistory.create({
                data: {
                    cell_id: existing?.id ?? null,
                    column_id: columnId,
                    student_id: studentId,
                    old_value: existing?.value ?? null,
                    new_value: value,
                    source: 'manual',
                    changed_by: actorId,
                    changed_at: now,
                },
            }),
        ]);
    }

    private async assertMember(groupId: number, studentId: number): Promise<void> {
        const member = await this.prisma.groupUser.findFirst({
            where: { group_id: groupId, user_id: studentId },
            select: { id: true },
        });
        if (!member) throw new BadRequestException({ code: 'rating_journal.student_not_in_group', message: 'rating_journal.student_not_in_group' });
    }

    public async history(actor: ScopeActor, query: HistoryQueryDto) {
        const page = query.page ?? 1;
        const pageSize = query.page_size ?? 50;

        // Authorize via the column's journal when a column filter is present
        // (admin — the only role granted history_view — bypasses, but stay defensive).
        if (query.column_id) {
            const columnId = parseBigIntId(query.column_id, 'column_id');
            const column = await this.prisma.ratingJournalColumn.findFirst({ where: { id: columnId }, select: { journal_id: true } });
            if (!column) throw new NotFoundException({ code: 'rating_journal.column_not_found', message: 'rating_journal.column_not_found' });
            await this.journals.resolveJournalForActor(actor, column.journal_id);
        } else if (actor.role_name !== 'admin') {
            throw new ForbiddenException({ code: 'rating_journal.history_scope_required', message: 'rating_journal.history_scope_required' });
        }

        const where = {
            ...(query.column_id ? { column_id: parseBigIntId(query.column_id, 'column_id') } : {}),
            ...(query.student_id ? { student_id: query.student_id } : {}),
        };
        const [rows, total] = await Promise.all([
            this.prisma.ratingJournalCellHistory.findMany({
                where,
                orderBy: [{ changed_at: 'desc' }, { id: 'desc' }],
                skip: (page - 1) * pageSize,
                take: pageSize,
            }),
            this.prisma.ratingJournalCellHistory.count({ where }),
        ]);
        const mapped: JournalCellHistoryRow[] = rows.map((r) => ({
            id: r.id.toString(),
            column_id: r.column_id.toString(),
            student_id: r.student_id,
            old_value: r.old_value,
            new_value: r.new_value,
            source: r.source,
            changed_by: r.changed_by,
            changed_at: r.changed_at,
        }));
        return { rows: mapped, total, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
    }
}
