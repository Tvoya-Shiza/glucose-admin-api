import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { buildScopeWhere } from '../../common/scoping/scope.helper';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { BANNER_SCOPE_RULES } from './banners.scope';
import { BulkStatusDto } from './dto/bulk-status.dto';
import { BannersCacheService } from './utils/banners-cache.service';
import { BANNERS_INVALIDATE_PATTERN } from './utils/banners-cache';

/**
 * BAN-03 — Plan 03 bulk-status service (D-08).
 *
 * Mirrors StoriesBulkService verbatim, swapping `prisma.story` -> `prisma.advertisement`
 * and `story_ids` -> `banner_ids` (wire field).
 *
 * Reference-implementation diff against Phase 3 Plan 05 (UsersBulkService):
 *   - Operation is `prisma.advertisement.update` (NOT a `prisma.advertisement.create`).
 *   - `affected = update count`. `result.update = affected`. `result.insert = 0`
 *     (kept in shape for DryRunDialog parity — Phase 3 Plan 05 reference contract).
 *   - Status taxonomy:
 *       'update'  current status differs from requested        -> counts toward affected
 *       'skip'    'already_in_status' (current === requested)  -> not committed
 *       'error'   'banner_not_found' (id missing or out of scope under BANNER_SCOPE_RULES)
 *
 *   - TX_CHUNK_SIZE = 500 (Phase 3 constant).
 *   - confirmed_count === affected gate when affected > CONFIRM_THRESHOLD (50).
 *   - bulk_op_id surfaces in response only.
 *   - On commit success: cache.invalidate(BANNERS_INVALIDATE_PATTERN).
 *
 * Predicate symmetry (D-13): dry-run uses the same scope+status classification as commit;
 * commit just additionally executes the chunked $transaction of `advertisement.update` ops.
 */

export interface BulkStatusResultRow {
    row_id: string;
    status: 'insert' | 'update' | 'skip' | 'error';
    reason: string | null;
    banner_id: number;
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
export class BannersBulkService {
    private readonly logger = new Logger(BannersBulkService.name);

    /** BAN-03: server gate for the type-the-count confirmation (matches Phase 3 USR-05). */
    public static readonly CONFIRM_THRESHOLD = 50;

    /** Chunk size for Advertisement.update batches inside prisma.$transaction. */
    public static readonly TX_CHUNK_SIZE = 500;

    constructor(
        private readonly prisma: PrismaService,
        private readonly cache: BannersCacheService,
    ) {}

    public async bulkStatus(actor: ScopeActor, dto: BulkStatusDto): Promise<BulkStatusResult> {
        const bulk_op_id =
            dto.bulk_op_id && /^[0-9a-f-]{8,}$/i.test(dto.bulk_op_id) ? dto.bulk_op_id : randomUUID();

        // 1. Resolve scope: which banner_ids is the actor allowed to touch?
        //    Admin sees all (rule omitted -> {}); others -> default-deny (id IN ()).
        const scopeWhere = buildScopeWhere(actor, BANNER_SCOPE_RULES);
        const allowedRows: Array<{ id: number; status: 'pending' | 'publish' }> =
            (await this.prisma.advertisement.findMany({
                where: { id: { in: dto.banner_ids }, ...(scopeWhere as object) },
                select: { id: true, status: true },
            })) as any[];
        const statusById = new Map<number, 'pending' | 'publish'>();
        for (const r of allowedRows) statusById.set(Number(r.id), r.status as 'pending' | 'publish');

        // 2. Walk requested ids and classify.
        const rows: BulkStatusResultRow[] = [];
        let updateCount = 0;
        let skipCount = 0;
        let errorCount = 0;

        for (const bid of dto.banner_ids) {
            const row_id = String(bid);
            const current = statusById.get(bid);
            if (!current) {
                rows.push({ row_id, status: 'error', reason: 'banner_not_found', banner_id: bid });
                errorCount++;
                continue;
            }
            if (current === dto.status) {
                rows.push({ row_id, status: 'skip', reason: 'already_in_status', banner_id: bid });
                skipCount++;
                continue;
            }
            rows.push({ row_id, status: 'update', reason: null, banner_id: bid });
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

        // T-07-03-02: server-side confirmation gate.
        if (affected > BannersBulkService.CONFIRM_THRESHOLD) {
            if (typeof dto.confirmed_count !== 'number' || dto.confirmed_count !== affected) {
                throw new BadRequestException(
                    `confirmation_required:expected_${affected}_got_${dto.confirmed_count ?? 'null'}`,
                );
            }
        }

        if (affected === 0) return result;

        const now = Math.floor(Date.now() / 1000);
        const updates = rows.filter((r) => r.status === 'update');

        // Chunked $transaction (T-07-03-06): TX_CHUNK_SIZE updates per chunk.
        for (let i = 0; i < updates.length; i += BannersBulkService.TX_CHUNK_SIZE) {
            const chunk = updates.slice(i, i + BannersBulkService.TX_CHUNK_SIZE);
            await this.prisma.$transaction(
                chunk.map((r) =>
                    this.prisma.advertisement.update({
                        where: { id: r.banner_id },
                        data: { status: dto.status, updated_at: now },
                    }),
                ),
            );
        }

        await this.cache.invalidate(BANNERS_INVALIDATE_PATTERN);

        this.logger.log(
            `bulkStatus committed bulk_op_id=${bulk_op_id} actor=${actor.id} role=${actor.role_name} ` +
                `target_status=${dto.status} affected=${affected} skip=${skipCount} error=${errorCount}`,
        );

        return result;
    }
}
