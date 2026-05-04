import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { PushHistoryQueryDto } from './dto/push-history.dto';
import { PushHistoryService } from './push-history.service';

/**
 * Phase 8 Plan 03 — push history list (PSH-03, D-11).
 *
 * GET /admin-api/v1/admin/push/history?page=1&page_size=25&...
 *
 * RBAC (D-19):
 *   - admin   → all PushNotificationLog rows (no narrowing)
 *   - curator → rows where recipient is in a group the curator supervises
 *   - teacher → rows where recipient bought a webinar the teacher owns
 *
 * Narrowing is applied inside PushHistoryService via PUSH_SCOPE_RULES.
 *
 * Audit: GET endpoints are exempt from ci:audit-required (CLAUDE.md AUTH-12).
 * The list shape itself is read-only — no audit row is written for browsing.
 */
@Controller('admin-api/v1/admin/push')
@UseGuards(JwtGuard, RolesGuard)
export class PushHistoryController {
    constructor(private readonly historySvc: PushHistoryService) {}

    @Get('history')
    @Roles('admin', 'curator', 'teacher')
    public async list(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Query() query: PushHistoryQueryDto,
    ) {
        return this.historySvc.list(query, { id: actor.id, role_name: actor.role_name });
    }
}
