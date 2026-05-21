import { Body, Controller, Param, ParseIntPipe, Post, Res, UseGuards } from '@nestjs/common';
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
import { ExportUserDetailDto, ExportUsersDto } from './dto/export-users.dto';
import { UsersExportService } from './users-export.service';

/**
 * USR-07 — POST /admin-api/v1/admin/users/export.
 *
 * Streams either a UTF-8 BOM CSV (`text/csv`) or an XLSX Buffer
 * (`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`) directly via
 * `@Res() res` — bypasses the `apiResponse` envelope. The xlsx Content-Type ALSO causes
 * the BigIntStringInterceptor to sidestep the binary (per glucose-admin-api/CLAUDE.md +
 * src/common/interceptors/bigint-string.interceptor.ts) — though `@Res()` already prevents
 * interceptor mapping over the response body, the explicit header is the locked contract.
 *
 * Throttle: 5 requests / 15 minutes / IP. Exports are expensive (50k row cap); the global
 * 100/min limit is too loose for this endpoint. Mirrors the `/auth/login` + `/auth/refresh`
 * tightening pattern in auth.controller.ts.
 *
 * Audit: `@Audit('users.export', 'user')` — every export attempt produces one audit row
 * (T-03-64 mitigation). Body filter values are not part of the audit shape, but the actor
 * + ts + ip + ua are sufficient to track who exported and when.
 */
@Controller('admin-api/v1/admin/users')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class UsersExportController {
    constructor(private readonly exportService: UsersExportService) {}

    @Post('export')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('users.export')
    @Audit('users.export', 'user')
    @Throttle({ default: { limit: 5, ttl: 900_000 } })
    public async export(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Body() dto: ExportUsersDto,
        @Res() res: Response,
    ): Promise<void> {
        const rows = await this.exportService.fetchRows({ id: actor.id, role_name: actor.role_name }, dto);
        const ts = Math.floor(Date.now() / 1000);

        if (dto.format === 'csv') {
            const csv = this.exportService.toCsv(rows);
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="users-${ts}.csv"`);
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
        res.setHeader('Content-Disposition', `attachment; filename="users-${ts}.xlsx"`);
        res.send(buf);
    }

    /**
     * Per-user audit report — profile + course access + quiz access + recent payments
     * in a single XLSX (4 sheets) or sectioned CSV. Scope is enforced inside the
     * detail/quizzes services (404 on out-of-scope id).
     *
     * Throttle: 10 calls / 15 min / IP — lighter than bulk export (5/15min) because
     * the surface targets a single user rather than the full filtered list.
     */
    @Post(':id/export')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('users.export')
    @Audit('users.exportDetail', 'user')
    @Throttle({ default: { limit: 10, ttl: 900_000 } })
    public async exportDetail(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: ExportUserDetailDto,
        @Res() res: Response,
    ): Promise<void> {
        const bundle = await this.exportService.fetchUserDetailBundle(
            { id: actor.id, role_name: actor.role_name },
            id,
        );
        const ts = Math.floor(Date.now() / 1000);

        if (dto.format === 'csv') {
            const csv = this.exportService.detailToCsv(bundle);
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="user-${id}-${ts}.csv"`);
            res.send(csv);
            return;
        }

        const buf = await this.exportService.detailToXlsx(bundle);
        res.setHeader(
            'Content-Type',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        );
        res.setHeader('Content-Disposition', `attachment; filename="user-${id}-${ts}.xlsx"`);
        res.send(buf);
    }
}
