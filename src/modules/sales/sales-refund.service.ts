import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * PAY-03 — refund a Sale by stamping `Sale.refund_at = nowSec`.
 *
 * Atomic + idempotent (T-09-03-02): the check-then-update happens inside a
 * `prisma.$transaction(async tx => ...)` callback — concurrent refund POSTs
 * cannot both succeed. The second request observes `refund_at !== null` and
 * throws ConflictException 409 (`sales.refund.already_refunded`).
 *
 * Schema-truth (verified against schema.prisma:715-746):
 *   - Sale.refund_at is `Int? @db.UnsignedInt` (Unix sec; null = active sale).
 *   - There is NO `refund_reason` column on Sale — reason is stored only in
 *     the audit log via @Audit('sales.refund', 'sale') interceptor (D-23).
 *
 * Kaspi-side refund is NOT triggered (D-07 / CONTEXT — "Kaspi-side refund
 * deferred to v2; manual ops process"). This service does ONE thing: stamp
 * refund_at. The audit row is the paper trail.
 *
 * RBAC (D-20, T-09-03-01): controller's @Roles('admin') already 403s non-admin.
 * Service throws ForbiddenException as belt-and-braces in case the gate ever
 * drifts or the service is invoked from a non-controller caller.
 */
export interface RefundResult {
    success: boolean;
    sale_id: number;
    refund_at: number;
    /** previous_refund_at is null on first refund (idempotency check guarantees).
     *  Returned for audit-meta visibility — interceptor may consume the response. */
    previous_refund_at: number | null;
}

@Injectable()
export class SalesRefundService {
    private readonly logger = new Logger(SalesRefundService.name);

    constructor(private readonly prisma: PrismaService) {}

    public async refund(actor: ScopeActor, sale_id: number, reason: string): Promise<RefundResult> {
        if (actor.role_name !== 'admin') {
            // Belt-and-braces — RolesGuard already returns 403; explicit throw keeps
            // service usable from non-controller callers (T-09-03-01).
            throw new ForbiddenException('sales.refund.admin_only');
        }
        const trimmed = (reason ?? '').trim();
        if (trimmed.length === 0) {
            // DTO already enforces @MinLength(3); this is a defensive last-mile guard.
            throw new ConflictException('sales.refund.reason_required');
        }

        // Atomic check-then-update inside $transaction so two concurrent refund
        // requests cannot both succeed. The second observation of refund_at
        // raises ConflictException 409 inside the same transaction (T-09-03-02).
        const result = await this.prisma.$transaction(async (tx) => {
            const sale = await tx.sale.findUnique({
                where: { id: sale_id },
                select: { id: true, refund_at: true },
            });
            if (!sale) {
                throw new NotFoundException('sales.not_found');
            }
            if (sale.refund_at !== null && sale.refund_at !== undefined) {
                throw new ConflictException('sales.refund.already_refunded');
            }
            const now = Math.floor(Date.now() / 1000);
            await tx.sale.update({
                where: { id: sale_id },
                data: { refund_at: now },
            });
            return { sale_id, refund_at: now, previous_refund_at: null as number | null };
        });

        this.logger.log(
            `sale ${result.sale_id} refunded at ${result.refund_at} by actor=${actor.id} reason="${trimmed.slice(0, 80)}"`,
        );

        return { success: true, ...result };
    }
}
