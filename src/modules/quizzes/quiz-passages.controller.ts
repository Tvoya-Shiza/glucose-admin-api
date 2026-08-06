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
    Query,
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
import { CreateQuizPassageDto, ListQuizPassagesDto, UpdateQuizPassageDto } from './dto/quiz-passage.dto';
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
 * Справочник контекстов (phase-53) — стимульные тексты формата ҰБТ, общие для
 * нескольких вопросов и переиспользуемые между тестами.
 *
 * Права те же, что у вопросов: чтение по `quizzes.view`, правка по
 * `quizzes.edit`. Отдельного права нет намеренно — как и у справочника тем, это
 * часть работы над тестами, а не самостоятельный раздел.
 *
 * Скоупа нет: справочник общий для платформы.
 */
@Controller('admin-api/v1/admin/quiz-passages')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class QuizPassagesController {
    constructor(private readonly svc: QuizPassagesService) {}

    @Get()
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('quizzes.view')
    public async list(@Query() query: ListQuizPassagesDto) {
        return this.svc.list(query);
    }

    @Get(':id')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('quizzes.view')
    public async read(@Param('id', ParseIntPipe) id: number) {
        return this.svc.read(id);
    }

    @Post()
    @Roles('admin', 'teacher')
    @RequirePermission('quizzes.edit')
    @Audit('quizzes.passage_create', 'quiz_passage')
    public async create(@CurrentUser() actor: AuthenticatedRequestUser, @Body() dto: CreateQuizPassageDto) {
        return this.svc.create({ id: actor.id, role_name: actor.role_name }, dto);
    }

    @Patch(':id')
    @Roles('admin', 'teacher')
    @RequirePermission('quizzes.edit')
    @Audit('quizzes.passage_update', 'quiz_passage')
    public async update(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: UpdateQuizPassageDto,
    ) {
        return this.svc.update({ id: actor.id, role_name: actor.role_name }, id, dto);
    }

    @Delete(':id')
    @Roles('admin', 'teacher')
    @RequirePermission('quizzes.edit')
    @Audit('quizzes.passage_delete', 'quiz_passage')
    @HttpCode(HttpStatus.OK)
    public async remove(@CurrentUser() actor: AuthenticatedRequestUser, @Param('id', ParseIntPipe) id: number) {
        return this.svc.remove({ id: actor.id, role_name: actor.role_name }, id);
    }
}

/**
 * Привязка вопросов теста к контексту.
 *
 * Осталась вложенной в тест, хотя сам справочник глобальный: непрерывность
 * вопросов блока проверяется В ПРЕДЕЛАХ ОДНОГО ТЕСТА, и без `quizId` проверять
 * было бы нечего.
 */
@Controller('admin-api/v1/admin/quizzes/:quizId/passages')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class QuizPassageAssignmentController {
    constructor(private readonly svc: QuizPassagesService) {}

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
