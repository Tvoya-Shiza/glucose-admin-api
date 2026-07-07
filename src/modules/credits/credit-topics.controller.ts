import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Audit } from '../../common/audit/audit.decorator';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { CreditTopicsService } from './credit-topics.service';
import { CreateCreditTopicDto } from './dto/create-credit-topic.dto';
import { ListCreditTopicsDto } from './dto/list-credit-topics.dto';
import { UpdateCreditTopicDto } from './dto/update-credit-topic.dto';
import { parseBigIntId } from './utils/ids';

/**
 * Credit topics tree CRUD (contract §credit-topics).
 * GET is gated by credits.view (bank consumers need the tree for filters/wizard);
 * writes by credits.topics_manage. No data scope — the bank is shared content.
 */
@Controller('admin-api/v1/admin/credit-topics')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class CreditTopicsController {
    constructor(private readonly svc: CreditTopicsService) {}

    @Get()
    @Roles('admin', 'curator')
    @RequirePermission('credits.view')
    public async list(@Query() query: ListCreditTopicsDto) {
        return this.svc.list(query);
    }

    @Post()
    @Roles('admin', 'curator')
    @RequirePermission('credits.topics_manage')
    @Audit('credits.topic_create', 'credit_topic')
    public async create(@CurrentUser() actor: AuthenticatedRequestUser, @Body() dto: CreateCreditTopicDto) {
        return this.svc.create({ id: actor.id, role_name: actor.role_name }, dto);
    }

    @Patch(':id')
    @Roles('admin', 'curator')
    @RequirePermission('credits.topics_manage')
    @Audit('credits.topic_update', 'credit_topic')
    public async update(@Param('id') idRaw: string, @Body() dto: UpdateCreditTopicDto) {
        return this.svc.update(parseBigIntId(idRaw), dto);
    }

    @Delete(':id')
    @Roles('admin', 'curator')
    @RequirePermission('credits.topics_manage')
    @Audit('credits.topic_delete', 'credit_topic')
    @HttpCode(HttpStatus.OK)
    public async remove(@Param('id') idRaw: string) {
        return this.svc.remove(parseBigIntId(idRaw));
    }
}
