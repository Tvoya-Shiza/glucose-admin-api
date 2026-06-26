import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { buildScopeWhere } from '../../common/scoping/scope.helper';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { STORY_SCOPE_RULES } from './stories.scope';
import { BulkStatusDto } from './dto/bulk-status.dto';
import { StoriesCacheService } from './utils/stories-cache.service';
import { STORIES_INVALIDATE_PATTERN, STORIES_PUBLIC_INVALIDATE_PATTERN } from './utils/stories-cache';

/**
 * STY-03 — Plan 02 Task 2 bulk-status service (D-07).
 *
 * Reference-implementation diff against Phase 3 Plan 05 (UsersBulkService):
 *   - Operation is `prisma.story.update` (NOT a `prisma.story.create`).
 *   - `affected = update count`. `result.update = affected`. `result.insert = 0`
 *     (kept in shape for DryRunDialog parity — Phase 3 Plan 05 reference contract).
 *   - Status taxonomy:
 *       'update'  current status differs from requested        -> counts toward affected
 *       'skip'    'already_in_status' (current === requested)  -> not committed
 *       'error'   'story_not_found' (id genuinely missing — STORY_SCOPE_RULES now {} for all admitted roles)
 *
 *   - TX_CHUNK_SIZE = 500 (Phase 3 constant).
 *   - confirmed_count === affected gate when affected > CONFIRM_THRESHOLD (50).
 *   - bulk_op_id surfaces in response only (Story has no bulk_op_id column — schema gap).
 *   - On commit success: cache.invalidate(STORIES_INVALIDATE_PATTERN).
 *
 * Predicate symmetry (D-13): dry-run uses the same scope+status classification as commit;
 * commit just additionally executes the chunked $transaction of `story.update` ops.
 */

export interface BulkStatusResultRow {
    row_id: string;
    status: 'insert' | 'update' | 'skip' | 'error';
    reason: string | null;
    story_id: number;
}

export interface BulkStatusResult {
    bulk_op_id: string;
    mode: 'dry_run' | 'commit';
    affected: number;
    insert: number;
    update: number;
    skip: number;
    error: number;
    rows: BulkStatusResultRow[];
}

@Injectable()
export class StoriesBulkService {
    private readonly logger = new Logger(StoriesBulkService.name);

    /** STY-03: server gate for the type-the-count confirmation (matches Phase 3 USR-05). */
    public static readonly CONFIRM_THRESHOLD = 50;

    /** Chunk size for Story.update batches inside prisma.$transaction. */
    public static readonly TX_CHUNK_SIZE = 500;

    constructor(
        private readonly prisma: PrismaService,
        private readonly cache: StoriesCacheService,
    ) {}

    public async bulkStatus(actor: ScopeActor, dto: BulkStatusDto): Promise<BulkStatusResult> {
        const bulk_op_id =
            dto.bulk_op_id && /^[0-9a-f-]{8,}$/i.test(dto.bulk_op_id) ? dto.bulk_op_id : randomUUID();

        // 1. Resolve scope: which story_ids is the actor allowed to touch?
        //    All admitted roles see all rows ({}); access governed by @RequirePermission.
        const scopeWhere = buildScopeWhere(actor, STORY_SCOPE_RULES);
        const allowedRows: Array<{ id: number; status: 'pending' | 'publish' }> =
            (await this.prisma.story.findMany({
                where: { id: { in: dto.story_ids }, ...(scopeWhere as object) },
                select: { id: true, status: true },
            })) as any[];
        const statusById = new Map<number, 'pending' | 'publish'>();
        for (const r of allowedRows) statusById.set(Number(r.id), r.status as 'pending' | 'publish');

        // 2. Walk requested ids and classify.
        const rows: BulkStatusResultRow[] = [];
        let updateCount = 0;
        let skipCount = 0;
        let errorCount = 0;

        for (const sid of dto.story_ids) {
            const row_id = String(sid);
            const current = statusById.get(sid);
            if (!current) {
                rows.push({ row_id, status: 'error', reason: 'story_not_found', story_id: sid });
                errorCount++;
                continue;
            }
            if (current === dto.status) {
                rows.push({ row_id, status: 'skip', reason: 'already_in_status', story_id: sid });
                skipCount++;
                continue;
            }
            rows.push({ row_id, status: 'update', reason: null, story_id: sid });
            updateCount++;
        }

        const affected = updateCount;
        const result: BulkStatusResult = {
            bulk_op_id,
            mode: dto.mode,
            affected,
            insert: 0,
            update: updateCount,
            skip: skipCount,
            error: errorCount,
            rows,
        };

        if (dto.mode === 'dry_run') return result;

        // ----- commit path -----

        // T-07-02-02: server-side confirmation gate.
        if (affected > StoriesBulkService.CONFIRM_THRESHOLD) {
            if (typeof dto.confirmed_count !== 'number' || dto.confirmed_count !== affected) {
                throw new BadRequestException(
                    `confirmation_required:expected_${affected}_got_${dto.confirmed_count ?? 'null'}`,
                );
            }
        }

        if (affected === 0) return result;

        const now = Math.floor(Date.now() / 1000);
        const updates = rows.filter((r) => r.status === 'update');

        // Chunked $transaction (T-07-02-06): TX_CHUNK_SIZE updates per chunk.
        for (let i = 0; i < updates.length; i += StoriesBulkService.TX_CHUNK_SIZE) {
            const chunk = updates.slice(i, i + StoriesBulkService.TX_CHUNK_SIZE);
            await this.prisma.$transaction(
                chunk.map((r) =>
                    this.prisma.story.update({
                        where: { id: r.story_id },
                        data: { status: dto.status, updated_at: now },
                    }),
                ),
            );
        }

        await this.cache.invalidate(STORIES_INVALIDATE_PATTERN);
        await this.cache.invalidate(STORIES_PUBLIC_INVALIDATE_PATTERN);

        this.logger.log(
            `bulkStatus committed bulk_op_id=${bulk_op_id} actor=${actor.id} role=${actor.role_name} ` +
                `target_status=${dto.status} affected=${affected} skip=${skipCount} error=${errorCount}`,
        );

        return result;
    }
}
