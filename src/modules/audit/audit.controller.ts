import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { AuditReadService } from './audit-read.service';
import { ListAuditDto } from './dto/list-audit.dto';
import type { AuditListResponseDto, DistinctValuesDto } from './dto/audit-row.dto';

/**
 * Audit-read endpoints (AUD-01 / AUD-02 / AUD-03 backend).
 *
 * Per D-23 — audit reads are NEVER audited (would create infinite log spam). All three
 * endpoints here are GETs, which the ci:audit-required lint already exempts by
 * construction. No @SkipAudit decorations needed (the lint only walks Post/Put/Patch/
 * Delete handlers in scripts/ci-audit-decorator-check.cjs).
 *
 * RBAC narrowing (D-02 + D-24) is server-enforced via AUDIT_READ_SCOPE_RULES in the
 * service — curator/teacher cannot widen visibility through query-param tampering
 * (T-10-03 — scope is spread LAST in where composition).
 */
@Controller('admin-api/v1/admin/audit')
@UseGuards(JwtGuard, RolesGuard)
export class AuditController {
    constructor(private readonly service: AuditReadService) {}

    @Get('log')
    @Roles('admin', 'curator', 'teacher')
    public async list(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Query() query: ListAuditDto,
    ): Promise<AuditListResponseDto> {
        return this.service.list({ id: actor.id, role_name: actor.role_name }, query);
    }

    @Get('actions')
    @Roles('admin', 'curator', 'teacher')
    public async actions(@CurrentUser() actor: AuthenticatedRequestUser): Promise<DistinctValuesDto> {
        return this.service.distinctActions({ id: actor.id, role_name: actor.role_name });
    }

    @Get('entities')
    @Roles('admin', 'curator', 'teacher')
    public async entities(@CurrentUser() actor: AuthenticatedRequestUser): Promise<DistinctValuesDto> {
        return this.service.distinctEntities({ id: actor.id, role_name: actor.role_name });
    }
}
