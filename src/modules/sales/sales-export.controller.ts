import { Body, Controller, Post, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Audit } from '../../common/audit/audit.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { ExportSalesDto } from './dto/export-sales.dto';
import { SalesExportService } from './sales-export.service';

/**
 * PAY-04 — POST /admin-api/v1/admin/sales/export.
 *
 * Streams either a UTF-8 BOM CSV (`text/csv`) or an XLSX Buffer
 * (`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`)
 * directly via `@Res() res` — bypasses the `apiResponse` envelope. The xlsx
 * Content-Type also causes the BigIntStringInterceptor to sidestep the binary
 * (per glucose-admin-api/CLAUDE.md). Mirrors PaymentsExportController (Phase 9
 * Plan 02) verbatim.
 *
 * RBAC (D-18, D-20): admin-only. Curator + teacher receive 403 from
 * RolesGuard.
 *
 * Throttle (T-09-03-06): `@Throttle({ default: { limit: 5, ttl: 900_000 } })`
 * — 5 req / 15 min / IP. Exports are expensive (50k row cap); the global
 * 100/min limit is too loose for this endpoint.
 *
 * Audit (D-23, T-09-03-06): `@Audit('sales.export', 'sale')` — every export
 * attempt produces one audit row (actor + ts + ip + ua). Filter values are not
 * captured in audit shape; actor + ts suffice to track who exported and when.
 */
@Controller('admin-api/v1/admin/sales')
@UseGuards(JwtGuard, RolesGuard)
export class SalesExportController {
    constructor(private readonly exportService: SalesExportService) {}

    @Post('export')
    @Roles('admin')
    @Audit('sales.export', 'sale')
    @Throttle({ default: { limit: 5, ttl: 900_000 } })
    public async export(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Body() dto: ExportSalesDto,
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
            res.setHeader('Content-Disposition', `attachment; filename="sales-${ts}.csv"`);
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
        res.setHeader('Content-Disposition', `attachment; filename="sales-${ts}.xlsx"`);
        res.send(buf);
    }
}
