import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { MailingsHistoryQueryDto } from './dto/mailings-history.dto';
import { MailingsHistoryService } from './mailings-history.service';

/**
 * Phase 8 Plan 05 — mailings history list (PSH-06, D-16).
 *
 * GET /admin-api/v1/admin/mailings/history?page=1&page_size=25&...
 *
 * RBAC (D-19): admin-only. Curator/teacher receive 403 from RolesGuard
 * BEFORE the service is reached.
 *
 * Audit: GET endpoints are exempt from ci:audit-required (CLAUDE.md AUTH-12).
 * The list shape itself is read-only — no audit row is written for browsing.
 */
@Controller('admin-api/v1/admin/mailings')
@UseGuards(JwtGuard, RolesGuard)
export class MailingsHistoryController {
    constructor(private readonly historySvc: MailingsHistoryService) {}

    @Get('history')
    @Roles('admin')
    public async list(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Query() query: MailingsHistoryQueryDto,
    ) {
        return this.historySvc.list(query, { id: actor.id, role_name: actor.role_name });
    }
}
