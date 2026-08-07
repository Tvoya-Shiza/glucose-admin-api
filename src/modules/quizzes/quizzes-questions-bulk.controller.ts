import { Body, Controller, HttpCode, HttpStatus, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { Audit } from '../../common/audit/audit.decorator';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { BulkTopicDto } from './dto/bulk-topic.dto';
import { QuizzesQuestionsBulkService } from './quizzes-questions-bulk.service';

/**
 * Массовые операции над вопросами теста (phase-55).
 *
 * Базовый путь намеренно `questions-bulk`, а не `questions`: у контроллера
 * вопросов есть `@Patch(':questionId')`, и любой новый статический маршрут на
 * том же базовом пути начал бы зависеть от порядка объявления. Отдельный путь
 * снимает вопрос целиком.
 */
@Controller('admin-api/v1/admin/quizzes/:quizId/questions-bulk')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class QuizzesQuestionsBulkController {
    constructor(private readonly svc: QuizzesQuestionsBulkService) {}

    @Post('topic')
    @Roles('admin', 'teacher')
    @RequirePermission('quizzes.edit')
    @Audit('quizzes.questions_bulk_topic', 'quiz_question')
    @HttpCode(HttpStatus.OK)
    public async assignTopic(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('quizId', ParseIntPipe) quizId: number,
        @Body() dto: BulkTopicDto,
    ) {
        return this.svc.assignTopic({ id: actor.id, role_name: actor.role_name }, quizId, dto);
    }
}
