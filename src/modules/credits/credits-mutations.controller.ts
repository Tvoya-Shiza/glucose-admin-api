import { Body, Controller, Delete, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Audit } from '../../common/audit/audit.decorator';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { CreditsMutationsService } from './credits-mutations.service';
import { CreateCreditDto } from './dto/create-credit.dto';
import { UpdateCreditDto } from './dto/update-credit.dto';
import { parseBigIntId } from './utils/ids';

/** Credit create / update / soft-delete (contract §credits CRUD). */
@Controller('admin-api/v1/admin/credits')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class CreditsMutationsController {
    constructor(private readonly svc: CreditsMutationsService) {}

    @Post()
    @Roles('admin', 'curator')
    @RequirePermission('credits.create')
    @Audit('credits.create', 'credit')
    public async create(@CurrentUser() actor: AuthenticatedRequestUser, @Body() dto: CreateCreditDto) {
        return this.svc.create({ id: actor.id, role_name: actor.role_name }, dto);
    }

    @Patch(':id')
    @Roles('admin', 'curator')
    @RequirePermission('credits.edit')
    @Audit('credits.update', 'credit')
    public async update(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id') idRaw: string,
        @Body() dto: UpdateCreditDto,
    ) {
        return this.svc.update({ id: actor.id, role_name: actor.role_name }, parseBigIntId(idRaw), dto);
    }

    @Delete(':id')
    @Roles('admin', 'curator')
    @RequirePermission('credits.delete')
    @Audit('credits.delete', 'credit')
    @HttpCode(HttpStatus.OK)
    public async remove(@CurrentUser() actor: AuthenticatedRequestUser, @Param('id') idRaw: string) {
        return this.svc.remove({ id: actor.id, role_name: actor.role_name }, parseBigIntId(idRaw));
    }
}
