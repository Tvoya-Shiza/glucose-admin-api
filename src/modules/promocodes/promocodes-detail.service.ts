import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PromocodesCacheService } from './utils/promocodes-cache.service';
import { PROMOCODES_DETAIL_PREFIX } from './utils/promocodes-cache';

/**
 * PRM-01 — promocode detail (Phase 7 Plan 05).
 *
 * Access is runtime-RBAC-driven via @RequirePermission('promocodes.view') on the
 * controller. Returns full Promocode record with Decimal fields serialized to string and the
 * `applicable_to` JSON normalized into the discriminated union shape.
 *
 * Schema-truth (Plan 01 lock):
 *   - Decimal(10,2) `discount_value`, Decimal(15,2) `max_discount_amount` /
 *     `minimum_order_amount` → `.toFixed(2)` string before egress (BigInt-as-string
 *     posture extends to Decimal per CLAUDE.md). Admin-client treats as opaque.
 *   - applicable_to JSON shape locked to `{type:'global'} | {type:'course', course_ids:number[]}`.
 *     Anything else is normalized to null (defensive). When type==='global', stale
 *     course_ids are dropped (T-07-05-06).
 *   - excluded_items kept as raw JSON (admin-client treats as `unknown`).
 *   - Promocode.id is `Int` (signed, NOT @db.UnsignedInt — diverges from Story/Blog).
 */
export type PromocodeApplicableTo =
    | { type: 'global' }
    | { type: 'course'; course_ids: number[] };

export interface PromocodeDetail {
    id: number;
    code: string;
    title: string | null;
    description: string | null;
    discount_type: 'percentage' | 'fixed';
    discount_value: string;
    max_discount_amount: string | null;
    minimum_order_amount: string | null;
    usage_limit: number | null;
    usage_limit_per_user: number | null;
    is_active: boolean;
    start_date: number;
    expires_at: number;
    creator_id: number;
    region_id: number | null;
    applicable_to: PromocodeApplicableTo | null;
    excluded_items: unknown | null;
    first_purchase_only: boolean;
    usage_count: number;
    created_at: number;
    updated_at: number;
}

/**
 * Defensive normalizer for the `applicable_to` JSON column. Returns null for any
 * shape that doesn't match the locked discriminated union — admin-client never
 * sees malformed payloads. When type==='global', drops course_ids (T-07-05-06).
 */
export function normalizeApplicableTo(raw: unknown): PromocodeApplicableTo | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    if (r.type === 'global') return { type: 'global' };
    if (r.type === 'course') {
        const ids = Array.isArray(r.course_ids)
            ? r.course_ids.filter((x): x is number => typeof x === 'number' && Number.isInteger(x) && x > 0)
            : [];
        return { type: 'course', course_ids: ids };
    }
    return null;
}

function decimalToString(value: unknown): string {
    if (value === null || value === undefined) return '0.00';
    // Prisma Decimal exposes .toFixed; fallback to String() for other shapes.
    if (typeof (value as { toFixed?: unknown }).toFixed === 'function') {
        return (value as { toFixed: (n: number) => string }).toFixed(2);
    }
    return String(value);
}

function decimalToStringOrNull(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (typeof (value as { toFixed?: unknown }).toFixed === 'function') {
        return (value as { toFixed: (n: number) => string }).toFixed(2);
    }
    return String(value);
}

@Injectable()
export class PromocodesDetailService {
    private readonly logger = new Logger(PromocodesDetailService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly cache: PromocodesCacheService,
    ) {}

    public async getDetail(id: number): Promise<PromocodeDetail> {
        const cacheKey = `${PROMOCODES_DETAIL_PREFIX}:${id}`;
        return this.cache.getOrSet(cacheKey, () => this.fetchDetail(id));
    }

    private async fetchDetail(id: number): Promise<PromocodeDetail> {
        const row: any = await this.prisma.promocode.findFirst({
            where: { id },
            include: { _count: { select: { usages: true } } },
        });

        if (!row) {
            throw new NotFoundException('promocodes.not_found');
        }

        return this.mapDetail(row);
    }

    /**
     * Map a Prisma row (with `_count.usages` included) to the detail DTO. Exposed
     * so the mutations service can reuse it inside a $transaction.
     */
    public mapDetail(row: any): PromocodeDetail {
        return {
            id: Number(row.id),
            code: String(row.code),
            title: row.title ?? null,
            description: row.description ?? null,
            discount_type: row.discount_type as 'percentage' | 'fixed',
            discount_value: decimalToString(row.discount_value),
            max_discount_amount: decimalToStringOrNull(row.max_discount_amount),
            minimum_order_amount: decimalToStringOrNull(row.minimum_order_amount),
            usage_limit: row.usage_limit ?? null,
            usage_limit_per_user: row.usage_limit_per_user ?? null,
            is_active: !!row.is_active,
            start_date: Number(row.start_date),
            expires_at: Number(row.expires_at),
            creator_id: Number(row.creator_id),
            region_id: row.region_id ?? null,
            applicable_to: normalizeApplicableTo(row.applicable_to),
            excluded_items: row.excluded_items ?? null,
            first_purchase_only: !!row.first_purchase_only,
            usage_count: Number(row._count?.usages ?? 0),
            created_at: Number(row.created_at),
            updated_at: Number(row.updated_at ?? row.created_at),
        };
    }
}
