import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { Audit } from '../../common/audit/audit.decorator';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { CreditsConductService } from './credits-conduct.service';
import { MarkQuestionDto } from './dto/mark-question.dto';
import { NavigateSessionDto } from './dto/navigate-session.dto';
import { ScheduleRetakeDto } from './dto/schedule-retake.dto';
import { parseBigIntId } from './utils/ids';

/**
 * Conduct console (contract §conduct; all gated by credits.conduct).
 * Viewing scope: any curator of the credit's group. Mutations additionally
 * require launch ownership (in-service assertLaunchOwnership) unless admin.
 * Every mutation returns the FULL fresh session detail (same shape as GET).
 */
@Controller('admin-api/v1/admin/credit-sessions')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class CreditsConductController {
    constructor(private readonly svc: CreditsConductService) {}

    @Get(':id')
    @Roles('admin', 'curator')
    @RequirePermission('credits.conduct')
    public async detail(@CurrentUser() actor: AuthenticatedRequestUser, @Param('id') idRaw: string) {
        return this.svc.getSession({ id: actor.id, role_name: actor.role_name }, parseBigIntId(idRaw));
    }

    @Post(':id/start')
    @Roles('admin', 'curator')
    @RequirePermission('credits.conduct')
    @Audit('credits.session_start', 'credit_session')
    @HttpCode(HttpStatus.OK)
    public async start(@CurrentUser() actor: AuthenticatedRequestUser, @Param('id') idRaw: string) {
        return this.svc.startSession({ id: actor.id, role_name: actor.role_name }, parseBigIntId(idRaw));
    }

    @Patch(':id/current')
    @Roles('admin', 'curator')
    @RequirePermission('credits.conduct')
    @Audit('credits.session_navigate', 'credit_session')
    public async navigate(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id') idRaw: string,
        @Body() dto: NavigateSessionDto,
    ) {
        return this.svc.navigate({ id: actor.id, role_name: actor.role_name }, parseBigIntId(idRaw), dto);
    }

    @Post(':id/questions/:position/mark')
    @Roles('admin', 'curator')
    @RequirePermission('credits.conduct')
    @Audit('credits.session_mark', 'credit_session')
    @HttpCode(HttpStatus.OK)
    public async mark(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id') idRaw: string,
        @Param('position', ParseIntPipe) position: number,
        @Body() dto: MarkQuestionDto,
    ) {
        return this.svc.markQuestion({ id: actor.id, role_name: actor.role_name }, parseBigIntId(idRaw), position, dto);
    }

    @Post(':id/finish')
    @Roles('admin', 'curator')
    @RequirePermission('credits.conduct')
    @Audit('credits.session_finish', 'credit_session')
    @HttpCode(HttpStatus.OK)
    public async finish(@CurrentUser() actor: AuthenticatedRequestUser, @Param('id') idRaw: string) {
        return this.svc.finishSession({ id: actor.id, role_name: actor.role_name }, parseBigIntId(idRaw));
    }

    @Post(':id/cancel')
    @Roles('admin', 'curator')
    @RequirePermission('credits.conduct')
    @Audit('credits.session_cancel', 'credit_session')
    @HttpCode(HttpStatus.OK)
    public async cancel(@CurrentUser() actor: AuthenticatedRequestUser, @Param('id') idRaw: string) {
        return this.svc.cancelSession({ id: actor.id, role_name: actor.role_name }, parseBigIntId(idRaw));
    }

    @Post(':id/schedule-retake')
    @Roles('admin', 'curator')
    @RequirePermission('credits.conduct')
    @Audit('credits.session_retake', 'credit_session')
    @HttpCode(HttpStatus.OK)
    public async scheduleRetake(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id') idRaw: string,
        @Body() dto: ScheduleRetakeDto,
    ) {
        return this.svc.scheduleRetake({ id: actor.id, role_name: actor.role_name }, parseBigIntId(idRaw), dto);
    }
}
