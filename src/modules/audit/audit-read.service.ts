import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { buildScopeWhere } from '../../common/scoping/scope.helper';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { AUDIT_READ_SCOPE_RULES } from './audit-read.scope';
import type { ListAuditDto } from './dto/list-audit.dto';
import type { AuditListResponseDto, AuditRowDto, DistinctValuesDto } from './dto/audit-row.dto';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const DISTINCT_HARD_CAP = 500;

/**
 * Audit-read service — single source of truth for AUD-01 / AUD-02 / AUD-03 backend.
 *
 * Posture (mirrors Phase 3 Plan 03 user-activity exactly):
 *   1. Delegate-existence guard — `(this.prisma as any).adminAuditLog` may be undefined when
 *      the schema regen has not run on this env (DATABASE_URL still placeholder).
 *      Service returns empty payload rather than 500.
 *   2. try/catch around the actual query — late-bound DB errors (e.g. table missing in real
 *      DB after schema introspection drift) ALSO return empty payload.
 *   3. AUDIT_READ_SCOPE_RULES spread LAST in where composition (T-10-03: prevents curator/
 *      teacher from widening visibility via query-param tampering).
 *   4. BigInt -> Number at the boundary (id is BigInt UnsignedBigInt; realistic values stay
 *      well under 2^53).
 *
 * D-08 — index alignment: orderBy { ts: 'desc' } combined with the actor-narrow-where for
 * curator/teacher hits (actor_id, ts) Phase 1.08 index; entity+entity_id filter hits
 * (entity, entity_id, ts). Distinct queries on indexed columns also hit the index.
 *
 * D-22 — no caching (real-time feed; staff expect fresh rows).
 * D-23 — these reads are NOT audited (would create infinite log spam); controllers are GETs
 * which the ci:audit-required lint exempts by construction.
 */
@Injectable()
export class AuditReadService {
    private readonly logger = new Logger(AuditReadService.name);

    constructor(private readonly prisma: PrismaService) {}

    public async list(actor: ScopeActor, q: ListAuditDto): Promise<AuditListResponseDto> {
        const page = q.page ?? 1;
        const page_size = Math.min(MAX_PAGE_SIZE, q.page_size ?? DEFAULT_PAGE_SIZE);

        const delegate: any = (this.prisma as any).adminAuditLog;
        if (!delegate || typeof delegate.findMany !== 'function' || typeof delegate.count !== 'function') {
            return { rows: [], total: 0, page, page_size };
        }

        const filterWhere: Record<string, unknown> = {};
        if (q.actor_id !== undefined) filterWhere.actor_id = q.actor_id;
        if (q.action) filterWhere.action = q.action;
        if (q.entity) filterWhere.entity = q.entity;
        if (q.entity_id) filterWhere.entity_id = q.entity_id;

        // ts range — Unix seconds Int. Hits (entity, entity_id, ts) and (actor_id, ts) Phase
        // 1.08 indexes (D-08).
        if (q.ts_from !== undefined || q.ts_to !== undefined) {
            const ts: Record<string, number> = {};
            if (q.ts_from !== undefined) ts.gte = q.ts_from;
            if (q.ts_to !== undefined) ts.lte = q.ts_to;
            filterWhere.ts = ts;
        }

        // Scope spread LAST so it cannot be widened by a tampered actor_id query param
        // (T-10-03). Admin scope returns {} so admin can filter freely.
        const scopeWhere = buildScopeWhere(actor, AUDIT_READ_SCOPE_RULES);
        const where = { ...filterWhere, ...scopeWhere };

        try {
            const [total, rows] = await this.prisma.$transaction([
                delegate.count({ where }),
                delegate.findMany({
                    where,
                    orderBy: { ts: 'desc' }, // D-03; index-friendly
                    skip: (page - 1) * page_size,
                    take: page_size,
                }),
            ]);
            return {
                rows: (rows as any[]).map(this.toRow),
                total: Number(total),
                page,
                page_size,
            };
        } catch (err) {
            this.logger.debug(`audit list read skipped: ${(err as Error).message}`);
            return { rows: [], total: 0, page, page_size };
        }
    }

    public async distinctActions(actor: ScopeActor): Promise<DistinctValuesDto> {
        return this.distinct(actor, 'action');
    }

    public async distinctEntities(actor: ScopeActor): Promise<DistinctValuesDto> {
        return this.distinct(actor, 'entity');
    }

    private async distinct(actor: ScopeActor, field: 'action' | 'entity'): Promise<DistinctValuesDto> {
        const delegate: any = (this.prisma as any).adminAuditLog;
        if (!delegate || typeof delegate.findMany !== 'function') return { values: [] };

        const scopeWhere = buildScopeWhere(actor, AUDIT_READ_SCOPE_RULES);
        try {
            const rows = (await delegate.findMany({
                where: scopeWhere,
                select: { [field]: true },
                distinct: [field],
                orderBy: { [field]: 'asc' },
                take: DISTINCT_HARD_CAP, // T-10-05 — combobox safety
            })) as Array<Record<string, string>>;
            return {
                values: rows.map((r) => r[field]).filter((v): v is string => typeof v === 'string'),
            };
        } catch (err) {
            this.logger.debug(`audit distinct ${field} skipped: ${(err as Error).message}`);
            return { values: [] };
        }
    }

    private toRow = (r: any): AuditRowDto => ({
        // BigInt -> Number at boundary; safe < 2^53. Matches Phase 3 Plan 03 user-activity cast.
        id: Number(r.id),
        ts: Number(r.ts),
        actor_id: r.actor_id !== null && r.actor_id !== undefined ? Number(r.actor_id) : null,
        action: r.action,
        entity: r.entity,
        entity_id: r.entity_id ?? null,
        ip: r.ip ?? null,
        ua: r.ua ?? null,
        before: r.before ?? null,
        after: r.after ?? null,
        meta: r.meta ?? null,
        bulk_op_id: r.bulk_op_id ?? null,
        request_id: r.request_id ?? null,
    });
}
