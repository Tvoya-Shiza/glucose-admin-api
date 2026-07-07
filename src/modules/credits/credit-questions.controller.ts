import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Audit } from '../../common/audit/audit.decorator';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { CreditQuestionsService } from './credit-questions.service';
import { AvailabilityCreditQuestionsDto } from './dto/availability-credit-questions.dto';
import { CreateCreditQuestionDto } from './dto/create-credit-question.dto';
import { ListCreditQuestionsDto } from './dto/list-credit-questions.dto';
import { UpdateCreditQuestionDto } from './dto/update-credit-question.dto';
import { parseBigIntId } from './utils/ids';

/**
 * Credit question bank CRUD (contract §credit-questions).
 *
 * Route ordering: the static GET 'availability' is declared BEFORE the ':id'
 * param routes so Nest's path matcher never absorbs the literal segment.
 * DELETE is admin-only (@Roles('admin')) per contract.
 */
@Controller('admin-api/v1/admin/credit-questions')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class CreditQuestionsController {
    constructor(private readonly svc: CreditQuestionsService) {}

    @Get()
    @Roles('admin', 'curator')
    @RequirePermission('credits.view')
    public async list(@Query() query: ListCreditQuestionsDto) {
        return this.svc.list(query);
    }

    /** MUST precede the ':id' routes. */
    @Get('availability')
    @Roles('admin', 'curator')
    @RequirePermission('credits.view')
    public async availability(@Query() query: AvailabilityCreditQuestionsDto) {
        return this.svc.availability(query.topic_ids);
    }

    @Post()
    @Roles('admin', 'curator')
    @RequirePermission('credits.questions_manage')
    @Audit('credits.question_create', 'credit_question')
    public async create(@CurrentUser() actor: AuthenticatedRequestUser, @Body() dto: CreateCreditQuestionDto) {
        return this.svc.create({ id: actor.id, role_name: actor.role_name }, dto);
    }

    @Patch(':id')
    @Roles('admin', 'curator')
    @RequirePermission('credits.questions_manage')
    @Audit('credits.question_update', 'credit_question')
    public async update(@Param('id') idRaw: string, @Body() dto: UpdateCreditQuestionDto) {
        return this.svc.update(parseBigIntId(idRaw), dto);
    }

    /** Hard delete of bank content — admin-only per contract. */
    @Delete(':id')
    @Roles('admin')
    @RequirePermission('credits.questions_manage')
    @Audit('credits.question_delete', 'credit_question')
    @HttpCode(HttpStatus.OK)
    public async remove(@Param('id') idRaw: string) {
        return this.svc.remove(parseBigIntId(idRaw));
    }
}
