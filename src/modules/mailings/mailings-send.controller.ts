import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { Audit } from '../../common/audit/audit.decorator';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { MailingSendDto } from './dto/mailings-send.dto';
import { MailingsSendService } from './mailings-send.service';

/**
 * Phase 8 Plan 05 — mailings send surface (PSH-05).
 *
 * Route:
 *   POST /admin-api/v1/admin/mailings/send — audited as 'mail.send'
 *
 * RBAC (D-19): runtime-driven. @Roles admits admin/curator/teacher; access is
 * governed by @RequirePermission('mailings.create') via PermissionGuard. The
 * send path's audience.resolve is RBAC-narrowed per-actor (T-08-05-01).
 *
 * Audit (D-17): AuditInterceptor writes one NDJSON line per request with
 * action='mail.send' + entity='mailing_log' + entity_id (response.broadcast_id
 * via the `id` shim) + actor_id. The interceptor does NOT capture the recipient
 * list — its meta carries broadcast_id + audience_hash + counts ONLY (D-17 GDPR
 * rule, T-08-05-03).
 */
@Controller('admin-api/v1/admin/mailings')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class MailingsSendController {
    constructor(private readonly sendSvc: MailingsSendService) {}

    @Post('send')
    @HttpCode(HttpStatus.OK)
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('mailings.create')
    @Audit('mail.send', 'mailing_log')
    public async send(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Body() body: MailingSendDto,
    ) {
        const result = await this.sendSvc.send(body, {
            id: actor.id,
            role_name: actor.role_name,
        });
        // Expose `id` so AuditInterceptor.resolveEntityId picks it up as entity_id.
        return { id: result.broadcast_id, ...result };
    }
}
