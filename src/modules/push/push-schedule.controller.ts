import {
    Body,
    Controller,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    Post,
    Query,
    UseGuards,
} from '@nestjs/common';
import { Audit } from '../../common/audit/audit.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { PushScheduleDto, PushScheduledListQueryDto } from './dto/push-schedule.dto';
import { PushScheduleService } from './push-schedule.service';

/**
 * Phase 8 Plan 04 — schedule queue surfaces (PSH-02).
 *
 * Routes:
 *   POST /admin-api/v1/admin/push/schedule           — admin-only, audited 'push.schedule'
 *   GET  /admin-api/v1/admin/push/scheduled          — admin-only, GET (audit-exempt)
 *   POST /admin-api/v1/admin/push/scheduled/:id/cancel — admin-only, audited 'push.schedule.cancel'
 *
 * The schedule controller is split from the broadcast controller so the
 * `controller count grows by 1` invariant in the plan is met cleanly
 * (broadcast + audience + history + schedule = 4 push controllers; +1 from Plan 03).
 *
 * RBAC (D-19): @Roles('admin'). Curator + teacher receive 403 from RolesGuard.
 *
 * Audit (D-17): both write endpoints carry @Audit. The audit row's entity_id is
 * the ScheduledPush id (response.id). The handler returns BigInt-as-string per
 * admin-api convention; AuditInterceptor.resolveEntityId picks the string up.
 */
@Controller('admin-api/v1/admin/push')
@UseGuards(JwtGuard, RolesGuard)
export class PushScheduleController {
    constructor(private readonly scheduleSvc: PushScheduleService) {}

    @Post('schedule')
    @HttpCode(HttpStatus.OK)
    @Roles('admin')
    @Audit('push.schedule', 'scheduled_push')
    public async schedule(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Body() body: PushScheduleDto,
    ) {
        return this.scheduleSvc.schedule(body, { id: actor.id, role_name: actor.role_name });
    }

    @Get('scheduled')
    @Roles('admin')
    public async list(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Query() query: PushScheduledListQueryDto,
    ) {
        return this.scheduleSvc.list(query, { id: actor.id, role_name: actor.role_name });
    }

    @Post('scheduled/:id/cancel')
    @HttpCode(HttpStatus.OK)
    @Roles('admin')
    @Audit('push.schedule.cancel', 'scheduled_push')
    public async cancel(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id') id: string,
    ) {
        // BigInt parse — the route param is a string; admin-client passes the
        // BigInt-as-string id from list responses.
        let bigId: bigint;
        try {
            bigId = BigInt(id);
        } catch {
            // Surface as a generic 404 — the row certainly does not exist if the
            // id isn't even parseable as a BigInt.
            return this.scheduleSvc.cancel(BigInt(0), { id: actor.id, role_name: actor.role_name });
        }
        return this.scheduleSvc.cancel(bigId, { id: actor.id, role_name: actor.role_name });
    }
}
