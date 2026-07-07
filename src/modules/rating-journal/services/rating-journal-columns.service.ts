import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { apiResponse } from '../../../common/utils/api-response';
import type { ScopeActor } from '../../../common/scoping/scope.types';
import { CreateColumnDto } from '../dto/create-column.dto';
import { ReorderColumnsDto } from '../dto/reorder-columns.dto';
import { UpdateColumnDto } from '../dto/update-column.dto';
import { parseBigIntId } from '../utils/ids';
import { nowSec } from '../utils/time';
import { RatingJournalService } from './rating-journal.service';

/**
 * Custom / attendance column management (TZ 2.3). Auto columns (module/credit —
 * source_ref_id != null) may only be hidden/shown, never renamed, re-maxed or
 * deleted here; their identity is owned by sync / the finalize adapter.
 */
@Injectable()
export class RatingJournalColumnsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly journals: RatingJournalService,
    ) {}

    public async create(actor: ScopeActor, dto: CreateColumnDto) {
        const journalId = parseBigIntId(dto.journal_id, 'journal_id');
        await this.journals.resolveJournalForActor(actor, journalId);

        const tail = await this.prisma.ratingJournalColumn.aggregate({ where: { journal_id: journalId }, _max: { position: true } });
        const position = dto.position ?? (tail._max.position ?? -1) + 1;

        const created = await this.prisma.ratingJournalColumn.create({
            data: {
                journal_id: journalId,
                title: dto.title.trim(),
                source_kind: dto.source_kind ?? 'custom',
                source_ref_id: null,
                chapter_id: dto.chapter_id ?? null,
                max_score: dto.max_score,
                position,
                created_by: actor.id,
                created_at: nowSec(),
            },
            select: this.columnSelect,
        });
        return apiResponse(1, 'created', 'admin.rating_journal.column_created', { column: this.toDto(created) });
    }

    public async update(actor: ScopeActor, id: bigint, dto: UpdateColumnDto) {
        const column = await this.loadOwned(actor, id);
        const isManual = column.source_ref_id === null;

        if ((dto.title !== undefined || dto.max_score !== undefined) && !isManual) {
            throw new ForbiddenException({ code: 'rating_journal.column_auto_readonly', message: 'rating_journal.column_auto_readonly' });
        }

        const data: Record<string, unknown> = { updated_at: nowSec() };
        if (dto.title !== undefined) data.title = dto.title.trim();
        if (dto.max_score !== undefined) data.max_score = dto.max_score;
        if (dto.is_hidden !== undefined) data.is_hidden = dto.is_hidden;
        if (Object.keys(data).length === 1) {
            throw new BadRequestException({ code: 'rating_journal.nothing_to_update', message: 'rating_journal.nothing_to_update' });
        }

        const updated = await this.prisma.ratingJournalColumn.update({ where: { id }, data, select: this.columnSelect });
        return apiResponse(1, 'updated', 'admin.rating_journal.column_updated', { column: this.toDto(updated) });
    }

    public async remove(actor: ScopeActor, id: bigint) {
        const column = await this.loadOwned(actor, id);
        if (column.source_ref_id !== null) {
            throw new ForbiddenException({ code: 'rating_journal.column_auto_undeletable', message: 'rating_journal.column_auto_undeletable' });
        }
        await this.prisma.ratingJournalColumn.update({ where: { id }, data: { deleted_at: nowSec() } });
        return apiResponse(1, 'deleted', 'admin.rating_journal.column_deleted', { id: id.toString(), deleted: true });
    }

    public async reorder(actor: ScopeActor, dto: ReorderColumnsDto) {
        if (dto.order.length === 0) {
            throw new BadRequestException({ code: 'rating_journal.reorder_empty', message: 'rating_journal.reorder_empty' });
        }
        const ids = dto.order.map((o) => parseBigIntId(o.id, 'order.id'));
        const columns = await this.prisma.ratingJournalColumn.findMany({
            where: { id: { in: ids }, deleted_at: null },
            select: { id: true, journal_id: true },
        });
        if (columns.length !== ids.length) {
            throw new NotFoundException({ code: 'rating_journal.column_not_found', message: 'rating_journal.column_not_found' });
        }
        const journalIds = new Set(columns.map((c) => c.journal_id.toString()));
        if (journalIds.size !== 1) {
            throw new BadRequestException({ code: 'rating_journal.reorder_cross_journal', message: 'rating_journal.reorder_cross_journal' });
        }
        await this.journals.resolveJournalForActor(actor, columns[0].journal_id);

        const now = nowSec();
        await this.prisma.$transaction(
            dto.order.map((o) =>
                this.prisma.ratingJournalColumn.update({
                    where: { id: parseBigIntId(o.id, 'order.id') },
                    data: { position: o.position, updated_at: now },
                }),
            ),
        );
        return apiResponse(1, 'updated', 'admin.rating_journal.columns_reordered', { reordered: dto.order.length });
    }

    /** Load a column and authorize the actor against its journal's group. */
    private async loadOwned(actor: ScopeActor, id: bigint) {
        const column = await this.prisma.ratingJournalColumn.findFirst({
            where: { id, deleted_at: null },
            select: { id: true, journal_id: true, source_ref_id: true },
        });
        if (!column) throw new NotFoundException({ code: 'rating_journal.column_not_found', message: 'rating_journal.column_not_found' });
        await this.journals.resolveJournalForActor(actor, column.journal_id);
        return column;
    }

    private readonly columnSelect = {
        id: true,
        title: true,
        source_kind: true,
        source_ref_id: true,
        chapter_id: true,
        max_score: true,
        position: true,
        is_hidden: true,
    } as const;

    private toDto(c: {
        id: bigint;
        title: string;
        source_kind: string;
        source_ref_id: bigint | null;
        chapter_id: number | null;
        max_score: number;
        position: number;
        is_hidden: boolean;
    }) {
        return {
            id: c.id.toString(),
            title: c.title,
            source_kind: c.source_kind,
            source_ref_id: c.source_ref_id == null ? null : c.source_ref_id.toString(),
            chapter_id: c.chapter_id,
            max_score: c.max_score,
            position: c.position,
            is_hidden: c.is_hidden,
            is_auto: c.source_ref_id !== null,
            is_custom: c.source_kind === 'custom',
        };
    }
}
