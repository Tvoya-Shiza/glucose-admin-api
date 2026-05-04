import {
    BadRequestException,
    ConflictException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { UpsertPromocodeDto } from './dto/upsert-promocode.dto';
import { PromocodesDetailService, type PromocodeDetail } from './promocodes-detail.service';
import { PromocodesCacheService } from './utils/promocodes-cache.service';
import { PROMOCODES_INVALIDATE_PATTERN } from './utils/promocodes-cache';

/**
 * PRM-01 — promocode create / update / hard-delete (Plan 05 Task 1).
 *
 * Decisions baked in:
 *
 *   - HARD delete (NOT soft): Promocode has NO `deleted_at` column. DELETE is a row
 *     removal; PromocodeUsage rows cascade via FK onDelete: Cascade (schema
 *     line 1426). UI gates the delete behind <TypeTheCountConfirmation> when
 *     usage_count > 0 (T-07-05-08 — admin-side acceptance documented).
 *
 *   - `code @unique` MySQL constraint enforces collision detection. Any concurrent
 *     create OR update that swaps code into an existing one produces Prisma `P2002`.
 *     We catch and rethrow as `ConflictException('code_already_exists')` (HTTP 409)
 *     so the admin-client can surface a friendly toast (T-07-05-02).
 *
 *   - applicable_to JSON shape locked to `{type:'global'} | {type:'course', course_ids:number[]}`
 *     (Plan 01 schema-truth lock #5). Defensive normalization: when type==='global',
 *     stale course_ids are dropped (T-07-05-06).
 *
 *   - Service additionally validates `expires_at > start_date` (T-07-05-03).
 *
 *   - Decimal fields (discount_value, max_discount_amount, minimum_order_amount) are
 *     accepted as strings on the wire, written to Prisma as strings (Prisma's Decimal
 *     coercion accepts numeric strings), and re-emitted via `.toFixed(2)` by the
 *     detail mapper.
 *
 *   - creator_id is set server-side from `actor.id` on create; PATCH does NOT change it.
 *
 *   - Unix-second timestamps (created_at + updated_at on create; updated_at bumped
 *     on every PATCH).
 *
 *   - Cache invalidation (D-19): every successful mutation invalidates
 *     PROMOCODES_INVALIDATE_PATTERN ('geonline-admin:promocodes:*') — aggressive
 *     nuke since Plan 05's read-side caching is OFF; the pattern is reserved for
 *     the polish pass.
 *
 *   - $transaction wraps the mutation + detail re-fetch so the response always
 *     reflects the post-write state (parity with stories pattern; future cascades
 *     such as audit-replay slot in here).
 */
@Injectable()
export class PromocodesMutationsService {
    private readonly logger = new Logger(PromocodesMutationsService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly cache: PromocodesCacheService,
        private readonly detailSvc: PromocodesDetailService,
    ) {}

    public async create(actor: ScopeActor, dto: UpsertPromocodeDto): Promise<PromocodeDetail> {
        this.assertWindowOrThrow(dto.start_date, dto.expires_at);
        const applicable_to = this.normalizeApplicableTo(dto.applicable_to);

        const now = Math.floor(Date.now() / 1000);

        try {
            const detail = await this.prisma.$transaction(async (tx) => {
                const created: any = await tx.promocode.create({
                    data: {
                        code: dto.code,
                        title: dto.title ?? null,
                        description: dto.description ?? null,
                        discount_type: dto.discount_type,
                        discount_value: dto.discount_value,
                        max_discount_amount: dto.max_discount_amount ?? null,
                        minimum_order_amount: dto.minimum_order_amount ?? null,
                        usage_limit: dto.usage_limit ?? null,
                        usage_limit_per_user: dto.usage_limit_per_user ?? null,
                        is_active: dto.is_active,
                        start_date: dto.start_date,
                        expires_at: dto.expires_at,
                        creator_id: actor.id,
                        region_id: dto.region_id ?? null,
                        applicable_to: applicable_to as any,
                        first_purchase_only: dto.first_purchase_only ?? false,
                        created_at: now,
                        updated_at: now,
                    },
                    select: { id: true },
                });

                const row: any = await tx.promocode.findFirst({
                    where: { id: created.id },
                    include: { _count: { select: { usages: true } } },
                });
                return this.detailSvc.mapDetail(row);
            });

            await this.cache.invalidate(PROMOCODES_INVALIDATE_PATTERN);
            return detail;
        } catch (e) {
            this.handlePrismaError(e);
            throw e;
        }
    }

    public async update(_actor: ScopeActor, id: number, dto: UpsertPromocodeDto): Promise<PromocodeDetail> {
        const existing: any = await this.prisma.promocode.findFirst({
            where: { id },
            select: { id: true },
        });
        if (!existing) throw new NotFoundException('promocodes.not_found');

        this.assertWindowOrThrow(dto.start_date, dto.expires_at);
        const applicable_to = this.normalizeApplicableTo(dto.applicable_to);

        const now = Math.floor(Date.now() / 1000);

        try {
            const detail = await this.prisma.$transaction(async (tx) => {
                await tx.promocode.update({
                    where: { id },
                    data: {
                        code: dto.code,
                        title: dto.title ?? null,
                        description: dto.description ?? null,
                        discount_type: dto.discount_type,
                        discount_value: dto.discount_value,
                        max_discount_amount: dto.max_discount_amount ?? null,
                        minimum_order_amount: dto.minimum_order_amount ?? null,
                        usage_limit: dto.usage_limit ?? null,
                        usage_limit_per_user: dto.usage_limit_per_user ?? null,
                        is_active: dto.is_active,
                        start_date: dto.start_date,
                        expires_at: dto.expires_at,
                        region_id: dto.region_id ?? null,
                        applicable_to: applicable_to as any,
                        first_purchase_only: dto.first_purchase_only ?? false,
                        updated_at: now,
                    },
                });

                const row: any = await tx.promocode.findFirst({
                    where: { id },
                    include: { _count: { select: { usages: true } } },
                });
                return this.detailSvc.mapDetail(row);
            });

            await this.cache.invalidate(PROMOCODES_INVALIDATE_PATTERN);
            return detail;
        } catch (e) {
            this.handlePrismaError(e);
            throw e;
        }
    }

    public async hardDelete(_actor: ScopeActor, id: number): Promise<{ id: number; deleted: true }> {
        const existing: any = await this.prisma.promocode.findFirst({
            where: { id },
            include: { _count: { select: { usages: true } } },
        });
        if (!existing) throw new NotFoundException('promocodes.not_found');

        // PromocodeUsage rows vanish via FK onDelete: Cascade (schema line 1426).
        await this.prisma.promocode.delete({ where: { id } });

        await this.cache.invalidate(PROMOCODES_INVALIDATE_PATTERN);
        return { id, deleted: true };
    }

    private assertWindowOrThrow(start_date: number, expires_at: number): void {
        if (expires_at <= start_date) {
            throw new BadRequestException('promocodes.expires_after_start_required');
        }
    }

    /**
     * Lock applicable_to to the discriminated union shape. T-07-05-06: when
     * type==='global', drop any course_ids the client may have left over.
     */
    private normalizeApplicableTo(
        raw: UpsertPromocodeDto['applicable_to'] | null | undefined,
    ): { type: 'global' } | { type: 'course'; course_ids: number[] } | null {
        if (!raw) return null;
        if (raw.type === 'global') return { type: 'global' };
        if (raw.type === 'course') {
            const ids = Array.isArray(raw.course_ids)
                ? raw.course_ids.filter((x) => Number.isInteger(x) && x > 0)
                : [];
            return { type: 'course', course_ids: ids };
        }
        return null;
    }

    /**
     * Translate Prisma errors to user-facing 4xx exceptions. Currently only P2002
     * (unique constraint) is handled — `code` is the only @unique column on Promocode.
     */
    private handlePrismaError(e: unknown): void {
        const code = (e as { code?: string } | null)?.code ?? null;
        if (code === 'P2002') {
            // Promocode.code is the only @unique column; safe to assume it's the source.
            throw new ConflictException('code_already_exists');
        }
    }
}
