import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { buildScopeWhere } from '../../common/scoping/scope.helper';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { BLOG_SCOPE_RULES } from './blogs.scope';
import { BulkStatusDto } from './dto/bulk-status.dto';
import { BlogsCacheService } from './utils/blogs-cache.service';
import { BLOGS_INVALIDATE_PATTERN } from './utils/blogs-cache';

/**
 * BLG-04 — Plan 04 Task 1 bulk-status service (D-12).
 *
 * Reference-implementation diff against Plans 02 (Stories) / 03 (Banners):
 *   - Operation is `prisma.blog.update`. Field name on DTO is `blog_ids`.
 *   - Status taxonomy:
 *       'update'  current status differs from requested        -> counts toward affected
 *       'skip'    'already_in_status' (current === requested)  -> not committed
 *       'error'   'blog_not_found' (id missing or out of scope under BLOG_SCOPE_RULES)
 *
 *   - TX_CHUNK_SIZE = 500 (Phase 3 constant).
 *   - confirmed_count === affected gate when affected > CONFIRM_THRESHOLD (50).
 *   - On commit success: cache.invalidate(BLOGS_INVALIDATE_PATTERN).
 */

export interface BulkStatusResultRow {
    row_id: string;
    status: 'insert' | 'update' | 'skip' | 'error';
    reason: string | null;
    blog_id: number;
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
export class BlogsBulkService {
    private readonly logger = new Logger(BlogsBulkService.name);

    /** BLG-04: server gate for the type-the-count confirmation (matches Phase 3 USR-05). */
    public static readonly CONFIRM_THRESHOLD = 50;

    /** Chunk size for Blog.update batches inside prisma.$transaction. */
    public static readonly TX_CHUNK_SIZE = 500;

    constructor(
        private readonly prisma: PrismaService,
        private readonly cache: BlogsCacheService,
    ) {}

    public async bulkStatus(actor: ScopeActor, dto: BulkStatusDto): Promise<BulkStatusResult> {
        const bulk_op_id =
            dto.bulk_op_id && /^[0-9a-f-]{8,}$/i.test(dto.bulk_op_id) ? dto.bulk_op_id : randomUUID();

        // 1. Resolve scope: which blog_ids is the actor allowed to touch?
        const scopeWhere = buildScopeWhere(actor, BLOG_SCOPE_RULES);
        const allowedRows: Array<{ id: number; status: 'pending' | 'publish' }> =
            (await this.prisma.blog.findMany({
                where: { id: { in: dto.blog_ids }, ...(scopeWhere as object) },
                select: { id: true, status: true },
            })) as any[];
        const statusById = new Map<number, 'pending' | 'publish'>();
        for (const r of allowedRows) statusById.set(Number(r.id), r.status as 'pending' | 'publish');

        // 2. Walk requested ids and classify.
        const rows: BulkStatusResultRow[] = [];
        let updateCount = 0;
        let skipCount = 0;
        let errorCount = 0;

        for (const bid of dto.blog_ids) {
            const row_id = String(bid);
            const current = statusById.get(bid);
            if (!current) {
                rows.push({ row_id, status: 'error', reason: 'blog_not_found', blog_id: bid });
                errorCount++;
                continue;
            }
            if (current === dto.status) {
                rows.push({ row_id, status: 'skip', reason: 'already_in_status', blog_id: bid });
                skipCount++;
                continue;
            }
            rows.push({ row_id, status: 'update', reason: null, blog_id: bid });
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

        // T-07-04-05: server-side confirmation gate.
        if (affected > BlogsBulkService.CONFIRM_THRESHOLD) {
            if (typeof dto.confirmed_count !== 'number' || dto.confirmed_count !== affected) {
                throw new BadRequestException(
                    `confirmation_required:expected_${affected}_got_${dto.confirmed_count ?? 'null'}`,
                );
            }
        }

        if (affected === 0) return result;

        const now = Math.floor(Date.now() / 1000);
        const updates = rows.filter((r) => r.status === 'update');

        // Chunked $transaction (T-07-04-10): TX_CHUNK_SIZE updates per chunk.
        for (let i = 0; i < updates.length; i += BlogsBulkService.TX_CHUNK_SIZE) {
            const chunk = updates.slice(i, i + BlogsBulkService.TX_CHUNK_SIZE);
            await this.prisma.$transaction(
                chunk.map((r) =>
                    this.prisma.blog.update({
                        where: { id: r.blog_id },
                        data: { status: dto.status, updated_at: now },
                    }),
                ),
            );
        }

        await this.cache.invalidate(BLOGS_INVALIDATE_PATTERN);

        this.logger.log(
            `bulkStatus committed bulk_op_id=${bulk_op_id} actor=${actor.id} role=${actor.role_name} ` +
                `target_status=${dto.status} affected=${affected} skip=${skipCount} error=${errorCount}`,
        );

        return result;
    }
}
