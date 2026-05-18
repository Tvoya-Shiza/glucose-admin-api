import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Audit } from '../../common/audit/audit.decorator';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { PushBroadcastDto, PushTestDto } from './dto/push-broadcast.dto';
import { PushBroadcastService } from './push-broadcast.service';

/**
 * Phase 8 Plan 03 — broadcast + test surfaces (PSH-01).
 *
 * Routes:
 *   POST /admin-api/v1/admin/push/broadcast — admin-only, audited as 'push.broadcast'
 *   POST /admin-api/v1/admin/push/test      — admin-only, audited as 'push.test'
 *
 * RBAC: @Roles('admin'). Curator/teacher receive 403 from RolesGuard before
 * the service is reached (T-08-03-01).
 *
 * Audit: AuditInterceptor writes one NDJSON line per request with action +
 * actor_id + entity_id (response.broadcast_id when present). The interceptor
 * does NOT capture the recipient list — its meta carries broadcast_id +
 * audience_hash + counts ONLY (D-17 GDPR rule, T-08-03-03).
 */
@Controller('admin-api/v1/admin/push')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class PushBroadcastController {
    constructor(private readonly broadcastSvc: PushBroadcastService) {}

    /**
     * PSH-01 ad-hoc broadcast. The audit row's entity_id is the response.broadcast_id;
     * AudienceService.resolve already RBAC-narrows (admin sees all by default), and
     * the broadcast_id round-trips back so the caller can reconstruct the attempt_id
     * sequence if needed for forensics.
     */
    @Post('broadcast')
    @HttpCode(HttpStatus.OK)
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('push.create')
    @Audit('push.broadcast', 'push_notification_log')
    public async broadcast(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Body() body: PushBroadcastDto,
    ) {
        const broadcastId = body.broadcast_id ?? randomUUID();
        const result = await this.broadcastSvc.broadcast(
            body.payload,
            body.audience,
            broadcastId,
            'admin.broadcast',
            { id: actor.id, role_name: actor.role_name },
        );
        // Expose `id` so AuditInterceptor.resolveEntityId picks it up as entity_id.
        return { id: result.broadcast_id, ...result };
    }

    /**
     * D-03: send a test push to actor.id only. trigger_type='admin.test'.
     */
    @Post('test')
    @HttpCode(HttpStatus.OK)
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('push.create')
    @Audit('push.test', 'push_notification_log')
    public async test(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Body() body: PushTestDto,
    ) {
        return this.broadcastSvc.sendTestToMe(actor.id, body.payload);
    }
}
