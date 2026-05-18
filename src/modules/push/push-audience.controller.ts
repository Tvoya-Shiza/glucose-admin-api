import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { Audit } from '../../common/audit/audit.decorator';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { AudienceService } from '../audience/audience.service';
import { AudienceShapeDto } from '../audience/dto/audience-preview.dto';

/**
 * PSH-01 — server-computed audience-size preview (D-02).
 *
 * Routes:
 *   POST /admin-api/v1/admin/push/audience-preview  -> {count, sample[<=5], audience_hash, cached}
 *
 * RBAC (D-19): admin-only. Curator/teacher receive 403 from RolesGuard before
 * AudienceService is reached. AudienceService.preview() ALSO applies
 * AUDIENCE_SCOPE_RULES belt-and-braces — defense in depth.
 *
 * Audit (D-17): non-GET handler MUST carry @Audit. Action 'push.audience-preview'
 * is read-only conceptually (no DB writes outside the audit log itself), but the
 * audit trail of who ran which audience-shape against the system is the desired
 * forensic record (T-08-02-02 mitigation: mass enumeration leaves a trail).
 *
 * Caching: 30s under geonline-admin:push:audience:<role>:<actor_id>:<sha256(filter)>
 * — the actor identity is part of the key so curator-narrowed previews don't bleed
 * into admin previews when an admin posts the same filter.
 */
@Controller('admin-api/v1/admin/push')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class PushAudienceController {
    constructor(private readonly audience: AudienceService) {}

    @Post('audience-preview')
    @HttpCode(HttpStatus.OK)
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('push.view')
    @Audit('push.audience-preview', 'audience')
    public async preview(@CurrentUser() actor: AuthenticatedRequestUser, @Body() body: AudienceShapeDto) {
        return this.audience.preview(body, { id: actor.id, role_name: actor.role_name });
    }
}
