import {
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
    UseGuards,
} from '@nestjs/common';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { Audit } from '../../common/audit/audit.decorator';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { CreateQuizPassageDto, UpdateQuizPassageDto } from './dto/quiz-passage.dto';
import { QuizPassagesService } from './quiz-passages.service';

/** Тело привязки вопросов к блоку. `passage_id: null` — отвязать. */
export class AssignPassageQuestionsDto {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    passage_id?: number | null;

    @IsArray()
    @ArrayMinSize(1)
    // Потолок совпадает с разумным размером теста: привязать «все вопросы разом»
    // должно быть можно, а вот тысяча идентификаторов в теле — уже признак ошибки.
    @ArrayMaxSize(500)
    @Type(() => Number)
    @IsInt({ each: true })
    question_ids!: number[];
}

/**
 * Текстовые блоки теста (phase-52) — стимульный текст формата ҰБТ, общий для
 * нескольких вопросов.
 *
 * Права те же, что у вопросов: чтение по `quizzes.view`, правка по
 * `quizzes.edit`. Блок — часть содержимого теста, отдельной ответственности у
 * него нет.
 */
@Controller('admin-api/v1/admin/quizzes/:quizId/passages')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class QuizPassagesController {
    constructor(private readonly svc: QuizPassagesService) {}

    @Get()
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('quizzes.view')
    public async list(@CurrentUser() actor: AuthenticatedRequestUser, @Param('quizId', ParseIntPipe) quizId: number) {
        return this.svc.list({ id: actor.id, role_name: actor.role_name }, quizId);
    }

    @Post()
    @Roles('admin', 'teacher')
    @RequirePermission('quizzes.edit')
    @Audit('quizzes.passage_create', 'quiz_passage')
    public async create(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('quizId', ParseIntPipe) quizId: number,
        @Body() dto: CreateQuizPassageDto,
    ) {
        return this.svc.create({ id: actor.id, role_name: actor.role_name }, quizId, dto);
    }

    @Patch(':id')
    @Roles('admin', 'teacher')
    @RequirePermission('quizzes.edit')
    @Audit('quizzes.passage_update', 'quiz_passage')
    public async update(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('quizId', ParseIntPipe) quizId: number,
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: UpdateQuizPassageDto,
    ) {
        return this.svc.update({ id: actor.id, role_name: actor.role_name }, quizId, id, dto);
    }

    @Delete(':id')
    @Roles('admin', 'teacher')
    @RequirePermission('quizzes.edit')
    @Audit('quizzes.passage_delete', 'quiz_passage')
    @HttpCode(HttpStatus.OK)
    public async remove(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('quizId', ParseIntPipe) quizId: number,
        @Param('id', ParseIntPipe) id: number,
    ) {
        return this.svc.remove({ id: actor.id, role_name: actor.role_name }, quizId, id);
    }

    @Post('assign')
    @Roles('admin', 'teacher')
    @RequirePermission('quizzes.edit')
    @Audit('quizzes.passage_assign', 'quiz_passage')
    @HttpCode(HttpStatus.OK)
    public async assign(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('quizId', ParseIntPipe) quizId: number,
        @Body() dto: AssignPassageQuestionsDto,
    ) {
        return this.svc.assignQuestions(
            { id: actor.id, role_name: actor.role_name },
            quizId,
            dto.passage_id ?? null,
            dto.question_ids,
        );
    }
}
