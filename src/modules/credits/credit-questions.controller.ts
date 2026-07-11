import {
    BadRequestException,
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    Patch,
    Post,
    Query,
    Res,
    UploadedFile,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Audit } from '../../common/audit/audit.decorator';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { CreditQuestionsService } from './credit-questions.service';
import { CreditQuestionsImportService } from './credit-questions-import.service';
import { AvailabilityCreditQuestionsDto } from './dto/availability-credit-questions.dto';
import { CreateCreditQuestionDto } from './dto/create-credit-question.dto';
import { ImportCreditQuestionsDto } from './dto/import-credit-questions.dto';
import { ListCreditQuestionsDto } from './dto/list-credit-questions.dto';
import { UpdateCreditQuestionDto } from './dto/update-credit-question.dto';
import { parseBigIntId } from './utils/ids';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

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
    constructor(
        private readonly svc: CreditQuestionsService,
        private readonly importSvc: CreditQuestionsImportService,
    ) {}

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

    /**
     * Empty Excel import template (one «Вопросы» sheet + Инструкция). Static route
     * — MUST precede ':id'. GET → audit-exempt.
     */
    @Get('import/template')
    @Roles('admin', 'curator')
    @RequirePermission('credits.view')
    @Throttle({ default: { limit: 30, ttl: 60_000 } })
    public async importTemplate(@Res() res: Response): Promise<void> {
        const buf = await this.importSvc.buildTemplate();
        res.setHeader('Content-Type', XLSX_MIME);
        res.setHeader('Content-Disposition', 'attachment; filename="credit-questions-template.xlsx"');
        res.send(buf);
    }

    /**
     * Bulk-import questions from an uploaded workbook into ONE topic/lesson
     * (topic_id XOR chapter_item_id). Purely additive; partial success per row.
     */
    @Post('import')
    @Roles('admin', 'curator')
    @RequirePermission('credits.questions_manage')
    @Audit('credits.question_import', 'credit_question')
    @UseInterceptors(
        FileInterceptor('file', {
            storage: memoryStorage(),
            limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
        }),
    )
    public async import(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Query() query: ImportCreditQuestionsDto,
        @UploadedFile() file: Express.Multer.File,
    ) {
        if (!file) throw new BadRequestException('file_required');
        return this.importSvc.importFromBuffer(
            { id: actor.id, role_name: actor.role_name },
            { topic_id: query.topic_id, chapter_item_id: query.chapter_item_id },
            file.buffer,
        );
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
    public async update(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id') idRaw: string,
        @Body() dto: UpdateCreditQuestionDto,
    ) {
        return this.svc.update({ id: actor.id, role_name: actor.role_name }, parseBigIntId(idRaw), dto);
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
