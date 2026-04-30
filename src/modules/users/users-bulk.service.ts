import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { buildScopeWhere } from '../../common/scoping/scope.helper';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { USER_SCOPE_RULES } from './users.scope';
import { BulkProvisionDto } from './dto/bulk-provision.dto';

/**
 * USR-04 + USR-05 — Plan 05 bulk-provision service.
 *
 * Single entry point `provision(actor, dto)` serving both dry-run preview and commit.
 * Both modes use the IDENTICAL predicate so the preview is faithful (T-03-42 + D-13):
 *   1. resolve users in actor scope (USER_SCOPE_RULES); out-of-scope -> 'user_out_of_scope'
 *   2. resolve webinars; teacher actor must own each webinar -> 'webinar_out_of_scope'
 *   3. existing Sale (buyer_id, webinar_id, refund_at IS NULL) -> 'already_has_access' skip
 *   4. otherwise -> insert
 *
 * Refunded Sale rows (refund_at IS NOT NULL) do NOT block re-grant — re-granting after
 * refund is intentional (T-03-46 accepted).
 *
 * Commit path:
 *   - mints bulk_op_id (UUIDv4) if not supplied
 *   - if affected > CONFIRM_THRESHOLD (50) AND confirmed_count !== affected -> 400
 *   - chunks Sale.create into TX_CHUNK_SIZE batches inside prisma.$transaction so:
 *       a. each chunk is atomic (partial-chunk failure rolls back THAT chunk)
 *       b. transaction time stays within Prisma's default ceiling (T-03-44)
 *
 * Schema gap: Sale model in `prisma/schema.prisma` does NOT carry `bulk_op_id`.
 * The id appears in the response body + (downstream) AdminAuditLog meta only.
 * Future schema-pass could add `bulk_op_id String?` to Sale — call sites here
 * would only need to add `bulk_op_id` to the `data:` payload.
 *
 * Reference-implementation note: Phase 7 (Stories/Banners/Blogs/Promocodes
 * bulk-status changes) reuses this shape — clone the dry-run + commit + chunked
 * $transaction structure verbatim, swap the predicate per resource.
 */

export interface BulkProvisionResultRow {
    row_id: string;
    status: 'insert' | 'update' | 'skip' | 'error';
    reason: string | null;
    user_id: number;
    webinar_id: number;
}

export interface BulkProvisionResult {
    bulk_op_id: string;
    mode: 'dry_run' | 'commit';
    affected: number;
    insert: number;
    update: number;
    skip: number;
    error: number;
    rows: BulkProvisionResultRow[];
}

@Injectable()
export class UsersBulkService {
    private readonly logger = new Logger(UsersBulkService.name);

    /** USR-05: server gate for the type-the-count confirmation. */
    public static readonly CONFIRM_THRESHOLD = 50;

    /** Chunk size for Sale.create batches inside prisma.$transaction. */
    public static readonly TX_CHUNK_SIZE = 500;

    constructor(private readonly prisma: PrismaService) {}

    public async provision(actor: ScopeActor, dto: BulkProvisionDto): Promise<BulkProvisionResult> {
        // Accept client-supplied bulk_op_id if it looks UUID-ish; otherwise mint.
        const bulk_op_id =
            dto.bulk_op_id && /^[0-9a-f-]{8,}$/i.test(dto.bulk_op_id) ? dto.bulk_op_id : randomUUID();

        // 1. Resolve user scope: which user_ids is the actor allowed to touch?
        const scopeWhere = buildScopeWhere(actor, USER_SCOPE_RULES);
        const allowedUsers = await this.prisma.user.findMany({
            where: { id: { in: dto.user_ids }, deleted_at: null, ...(scopeWhere as object) },
            select: { id: true },
        });
        const allowedUserIds = new Set<number>(allowedUsers.map((u: { id: number }) => Number(u.id)));

        // 2. Resolve webinar scope: teacher actor can only grant access to own webinars;
        //    admin/curator any (subject to upstream RolesGuard).
        const webinarRows = await this.prisma.webinar.findMany({
            where: { id: { in: dto.webinar_ids } },
            select: { id: true, teacher_id: true },
        });
        const webinarMap = new Map<number, { teacher_id: number | null }>();
        for (const w of webinarRows as Array<{ id: number; teacher_id: number | null }>) {
            webinarMap.set(Number(w.id), {
                teacher_id: w.teacher_id != null ? Number(w.teacher_id) : null,
            });
        }

        // 3. Look up existing Sale rows to mark skip on duplicates (active access only —
        //    refunded rows do not count, T-03-46).
        const existing = await this.prisma.sale.findMany({
            where: {
                buyer_id: { in: dto.user_ids },
                webinar_id: { in: dto.webinar_ids },
                refund_at: null,
            },
            select: { buyer_id: true, webinar_id: true },
        });
        const existingKey = new Set<string>(
            (existing as Array<{ buyer_id: number; webinar_id: number | null }>).map(
                (s) => `${Number(s.buyer_id)}:${Number(s.webinar_id)}`,
            ),
        );

        // 4. Walk the cartesian product, classifying each (user_id, webinar_id) pair.
        const rows: BulkProvisionResultRow[] = [];
        let insert = 0;
        let skip = 0;
        let error = 0;

        for (const u of dto.user_ids) {
            for (const w of dto.webinar_ids) {
                const row_id = `${u}:${w}`;
                if (!allowedUserIds.has(u)) {
                    rows.push({ row_id, status: 'error', reason: 'user_out_of_scope', user_id: u, webinar_id: w });
                    error++;
                    continue;
                }
                if (!webinarMap.has(w)) {
                    rows.push({ row_id, status: 'error', reason: 'webinar_not_found', user_id: u, webinar_id: w });
                    error++;
                    continue;
                }
                if (actor.role_name === 'teacher' && webinarMap.get(w)!.teacher_id !== actor.id) {
                    rows.push({ row_id, status: 'error', reason: 'webinar_out_of_scope', user_id: u, webinar_id: w });
                    error++;
                    continue;
                }
                if (existingKey.has(`${u}:${w}`)) {
                    rows.push({ row_id, status: 'skip', reason: 'already_has_access', user_id: u, webinar_id: w });
                    skip++;
                    continue;
                }
                rows.push({ row_id, status: 'insert', reason: null, user_id: u, webinar_id: w });
                insert++;
            }
        }

        const affected = insert; // Sale rows we'd actually create
        const result: BulkProvisionResult = {
            bulk_op_id,
            mode: dto.mode,
            affected,
            insert,
            update: 0,
            skip,
            error,
            rows,
        };

        if (dto.mode === 'dry_run') return result;

        // ----- commit path -----

        // T-03-42: server-side confirmation gate (independent of UI).
        if (affected > UsersBulkService.CONFIRM_THRESHOLD) {
            if (typeof dto.confirmed_count !== 'number' || dto.confirmed_count !== affected) {
                throw new BadRequestException(
                    `confirmation_required:expected_${affected}_got_${dto.confirmed_count ?? 'null'}`,
                );
            }
        }

        if (affected === 0) return result;

        const now = Math.floor(Date.now() / 1000);
        const inserts = rows.filter((r) => r.status === 'insert');

        // Chunked $transaction (T-03-44): split into TX_CHUNK_SIZE rows so each chunk is
        // a short atomic write. If a chunk's $transaction fails (e.g. FK violation), THAT
        // chunk rolls back. Earlier chunks' Sale rows remain — partial success is recoverable
        // via SELECT WHERE bulk_op_id once the schema column exists.
        for (let i = 0; i < inserts.length; i += UsersBulkService.TX_CHUNK_SIZE) {
            const chunk = inserts.slice(i, i + UsersBulkService.TX_CHUNK_SIZE);
            await this.prisma.$transaction(
                chunk.map((r) =>
                    this.prisma.sale.create({
                        data: {
                            buyer_id: r.user_id,
                            webinar_id: r.webinar_id,
                            amount: 0, // Decimal(13,2) NOT NULL — manual grants have no payment.
                            total_amount: 0,
                            manual_added: true, // USR-04 acceptance: distinguishes from paid sales.
                            access_to_purchased_item: true,
                            access_days: dto.access_days ?? null,
                            created_at: now,
                            // seller_id intentionally omitted — manual grant has no seller.
                            // bulk_op_id NOT in schema (see header note); response carries it.
                        },
                    }),
                ),
            );
        }

        this.logger.log(
            `bulkProvision committed bulk_op_id=${bulk_op_id} actor=${actor.id} role=${actor.role_name} ` +
                `affected=${affected} skip=${skip} error=${error}`,
        );

        return result;
    }
}
