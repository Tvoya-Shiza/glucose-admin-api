import { Body, Controller, Post, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Audit } from '../../common/audit/audit.decorator';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { ExportPaymentsDto } from './dto/export-payments.dto';
import { PaymentsExportService } from './payments-export.service';

/**
 * PAY-04 — POST /admin-api/v1/admin/payments/export.
 *
 * Streams either a UTF-8 BOM CSV (`text/csv`) or an XLSX Buffer
 * (`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`) directly via
 * `@Res() res` — bypasses the `apiResponse` envelope. The xlsx Content-Type also
 * causes the BigIntStringInterceptor to sidestep the binary (per
 * glucose-admin-api/CLAUDE.md). Mirrors UsersExportController (Phase 3 Plan 07).
 *
 * RBAC (D-18): admin-only. Curator + teacher receive 403 from RolesGuard. This is
 * the differentiator from the users-export reference impl (which allows
 * admin/curator/teacher) — payments are an admin-only surface per the threat model.
 *
 * Throttle: 5 requests / 15 minutes / IP. Exports are expensive (50k row cap); the
 * global 100/min limit is too loose for this endpoint. Mirrors users-export and the
 * /auth/login + /auth/refresh tightening pattern (T-09-02-04 mitigation).
 *
 * Audit: `@Audit('payments.export', 'kaspi_payment')` — every export attempt produces
 * one audit row (T-09-02-03 mitigation). Filter values are not part of the audit
 * shape, but actor + ts + ip + ua suffice to track who exported and when.
 */
@Controller('admin-api/v1/admin/payments')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class PaymentsExportController {
    constructor(private readonly exportService: PaymentsExportService) {}

    @Post('export')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('payments.export')
    @Audit('payments.export', 'kaspi_payment')
    @Throttle({ default: { limit: 5, ttl: 900_000 } })
    public async export(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Body() dto: ExportPaymentsDto,
        @Res() res: Response,
    ): Promise<void> {
        const rows = await this.exportService.fetchRows(
            { id: actor.id, role_name: actor.role_name },
            dto,
        );
        const ts = Math.floor(Date.now() / 1000);

        if (dto.format === 'csv') {
            const csv = this.exportService.toCsv(rows);
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="payments-${ts}.csv"`);
            res.send(csv);
            return;
        }

        // xlsx — Content-Type set before send so the BigInt interceptor short-circuits
        // (defensive: @Res already bypasses interceptor mapping in NestJS).
        const buf = await this.exportService.toXlsx(rows);
        res.setHeader(
            'Content-Type',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        );
        res.setHeader('Content-Disposition', `attachment; filename="payments-${ts}.xlsx"`);
        res.send(buf);
    }
}
