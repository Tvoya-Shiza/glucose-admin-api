import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Res, UseGuards } from '@nestjs/common';
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
import { ExportTrainerResultsDto } from './dto/export-trainer-results.dto';
import { ListTrainerResultsDto } from './dto/list-trainer-results.dto';
import { TrainerResultsStatsDto } from './dto/trainer-results-stats.dto';
import { TrainerAttemptAnswersService } from './trainer-attempt-answers.service';
import { TrainerResultsExportService } from './trainer-results-export.service';
import { TrainerResultsService } from './trainer-results.service';

/**
 * Phase 38 — trainer attempt results surface.
 *
 * Routes:
 *   GET  /admin-api/v1/admin/trainer-results              -> list    (trainers.results_view)
 *   GET  /admin-api/v1/admin/trainer-results/stats        -> stats   (trainers.results_view)
 *   GET  /admin-api/v1/admin/trainer-results/:id/answers  -> разбор  (trainers.results_view)
 *   POST /admin-api/v1/admin/trainer-results/export       -> export  (trainers.export)
 *
 * List returns the raw `{ rows, total, pageCount }` shape (NOT wrapped in
 * apiResponse) per CLAUDE.md — TanStack Table consumes it directly.
 *
 * RBAC: buildTrainerResultsWhere in the services narrows curator (supervised
 * groups' students) and teacher (own-webinar trainer links, default-deny) —
 * this controller is a thin pass-through.
 *
 * Export throttle: 5 requests / 15 minutes / IP — exports are expensive (50k row
 * cap); mirrors the users-export tightening. Every export attempt is audited
 * (@Audit('trainers.export', 'quiz')). GET endpoints are exempt from the audit lint.
 */
@Controller('admin-api/v1/admin/trainer-results')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class TrainerResultsController {
    constructor(
        private readonly resultsService: TrainerResultsService,
        private readonly exportService: TrainerResultsExportService,
        private readonly answersService: TrainerAttemptAnswersService,
    ) {}

    @Get()
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('trainers.results_view')
    public async list(@CurrentUser() actor: AuthenticatedRequestUser, @Query() filters: ListTrainerResultsDto) {
        return this.resultsService.list({ id: actor.id, role_name: actor.role_name }, filters);
    }

    @Get('stats')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('trainers.results_view')
    public async stats(@CurrentUser() actor: AuthenticatedRequestUser, @Query() filters: TrainerResultsStatsDto) {
        return this.resultsService.stats({ id: actor.id, role_name: actor.role_name }, filters);
    }

    /**
     * Разбор одной попытки по вопросам. Отдельное право не заводим: кто видит
     * список результатов, тот вправе увидеть и ответы внутри своей выборки —
     * сужение делает тот же buildTrainerResultsWhere.
     */
    @Get(':attemptId/answers')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('trainers.results_view')
    public async answers(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('attemptId', ParseIntPipe) attemptId: number,
    ) {
        return this.answersService.getAttemptAnswers({ id: actor.id, role_name: actor.role_name }, attemptId);
    }

    @Post('export')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('trainers.export')
    @Audit('trainers.export', 'quiz')
    @Throttle({ default: { limit: 5, ttl: 900_000 } })
    public async export(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Body() dto: ExportTrainerResultsDto,
        @Res() res: Response,
    ): Promise<void> {
        const rows = await this.exportService.fetchRows({ id: actor.id, role_name: actor.role_name }, dto);
        const ts = Math.floor(Date.now() / 1000);

        if (dto.format === 'csv') {
            const csv = this.exportService.toCsv(rows);
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="trainer-results-${ts}.csv"`);
            res.send(csv);
            return;
        }

        // xlsx — Content-Type set before send so the BigInt interceptor short-circuits
        // (defensive: @Res already bypasses interceptor mapping in NestJS).
        const buf = await this.exportService.toXlsx(rows);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="trainer-results-${ts}.xlsx"`);
        res.send(buf);
    }
}
