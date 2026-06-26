import {
    BadRequestException,
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    ParseIntPipe,
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
import { ReorderQuestionsDto } from './dto/reorder-questions.dto';
import { UpsertQuestionDto } from './dto/upsert-question.dto';
import { QuizzesQuestionsService } from './quizzes-questions.service';
import { QuizzesQuestionsImportService } from './quizzes-questions-import.service';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * QZ-02 / QZ-06 — admin/teacher question CRUD + reorder (Phase 6 Plan 05).
 *
 * Routes (all under /admin-api/v1/admin/quizzes/:quizId/questions):
 *
 *   GET    ''               -> list questions       (admin/curator/teacher; service 403s curator)
 *   POST   ''               -> create question      (admin/teacher; NOT destructive)
 *   PATCH  'reorder'        -> batch reorder        (admin/teacher; NOT destructive)  **MUST come before :questionId**
 *   PATCH  ':questionId'    -> update question      (admin/teacher; destructive gate)
 *   DELETE ':questionId'    -> delete question      (admin/teacher; destructive gate)
 *
 * Route ordering: Nest matches PATCH 'reorder' AFTER PATCH ':questionId' would
 * absorb the literal "reorder" as a path parameter. We declare 'reorder' first
 * so its handler wins. Verified: Nest's path-to-regexp resolves declaration order
 * for static-vs-parameterized peers in this case.
 *
 * Audit (T-06-15): every mutation handler decorated. CI lint
 * `npm run ci:audit-required` verifies decoration on every non-GET handler.
 */
@Controller('admin-api/v1/admin/quizzes/:quizId/questions')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class QuizzesQuestionsController {
    constructor(
        private readonly svc: QuizzesQuestionsService,
        private readonly importSvc: QuizzesQuestionsImportService,
    ) {}

    @Get()
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('quizzes.view')
    public async list(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('quizId', ParseIntPipe) quizId: number,
    ) {
        return this.svc.listQuestions({ id: actor.id, role_name: actor.role_name }, quizId);
    }

    /**
     * Empty Excel template (one sheet per question type + Инструкция). Static
     * route — MUST be declared before ':questionId'. GET → audit-exempt.
     */
    @Get('import/template')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('quizzes.view')
    @Throttle({ default: { limit: 30, ttl: 60_000 } })
    public async importTemplate(
        @Param('quizId', ParseIntPipe) _quizId: number,
        @Res() res: Response,
    ): Promise<void> {
        const buf = await this.importSvc.buildTemplate();
        res.setHeader('Content-Type', XLSX_MIME);
        res.setHeader('Content-Disposition', 'attachment; filename="questions-template.xlsx"');
        res.send(buf);
    }

    /**
     * Bulk-import questions from an uploaded workbook. Purely additive (mirrors
     * create) — gated by quizzes.edit. Partial success: valid rows import even if
     * others fail; failures are returned per-row.
     */
    @Post('import')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('quizzes.edit')
    @Audit('quizzes.question.import', 'quiz_question')
    @UseInterceptors(
        FileInterceptor('file', {
            storage: memoryStorage(),
            limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
        }),
    )
    public async import(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('quizId', ParseIntPipe) quizId: number,
        @UploadedFile() file: Express.Multer.File,
    ) {
        if (!file) throw new BadRequestException('file_required');
        return this.importSvc.importFromBuffer({ id: actor.id, role_name: actor.role_name }, quizId, file.buffer);
    }

    @Post()
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('quizzes.edit')
    @Audit('quizzes.question.create', 'quiz_question')
    public async create(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('quizId', ParseIntPipe) quizId: number,
        @Body() dto: UpsertQuestionDto,
    ) {
        return this.svc.createQuestion({ id: actor.id, role_name: actor.role_name }, quizId, dto);
    }

    @Patch('reorder')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('quizzes.edit')
    @Audit('quizzes.question.reorder', 'quiz_question')
    public async reorder(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('quizId', ParseIntPipe) quizId: number,
        @Body() dto: ReorderQuestionsDto,
    ) {
        return this.svc.reorderQuestions({ id: actor.id, role_name: actor.role_name }, quizId, dto);
    }

    @Patch(':questionId')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('quizzes.edit')
    @Audit('quizzes.question.update', 'quiz_question')
    public async update(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('quizId', ParseIntPipe) quizId: number,
        @Param('questionId', ParseIntPipe) questionId: number,
        @Body() dto: UpsertQuestionDto,
    ) {
        return this.svc.updateQuestion(
            { id: actor.id, role_name: actor.role_name },
            quizId,
            questionId,
            dto,
        );
    }

    @Delete(':questionId')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('quizzes.edit')
    @Audit('quizzes.question.delete', 'quiz_question')
    @HttpCode(HttpStatus.OK)
    public async remove(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('quizId', ParseIntPipe) quizId: number,
        @Param('questionId', ParseIntPipe) questionId: number,
        @Query('force_confirm_token') forceConfirmToken?: string,
    ) {
        return this.svc.deleteQuestion(
            { id: actor.id, role_name: actor.role_name },
            quizId,
            questionId,
            forceConfirmToken ?? null,
        );
    }
}
