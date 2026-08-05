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
import { Audit } from '../../common/audit/audit.decorator';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { CreateQuizTopicDto, ListQuizTopicsDto, UpdateQuizTopicDto } from './dto/quiz-topic.dto';
import { QuizTopicsService } from './quiz-topics.service';

/**
 * Справочник тем тестов (phase-51). Зеркалит `CreditTopicsController`.
 *
 * Чтение открыто по `quizzes.view`: дерево нужно всем, кто редактирует вопросы
 * и смотрит разбор результата. Правка — по `quizzes.edit`: отдельного права не
 * заводим, справочник тем это часть работы над тестами, а не самостоятельный
 * раздел с собственной ответственностью.
 *
 * Скоупа нет — справочник общий для платформы, как и у зачётов.
 */
@Controller('admin-api/v1/admin/quiz-topics')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class QuizTopicsController {
    constructor(private readonly svc: QuizTopicsService) {}

    @Get()
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('quizzes.view')
    public async list(@Query() query: ListQuizTopicsDto) {
        return this.svc.list(query);
    }

    @Post()
    @Roles('admin', 'teacher')
    @RequirePermission('quizzes.edit')
    @Audit('quizzes.topic_create', 'quiz_topic')
    public async create(@CurrentUser() actor: AuthenticatedRequestUser, @Body() dto: CreateQuizTopicDto) {
        return this.svc.create({ id: actor.id, role_name: actor.role_name }, dto);
    }

    @Patch(':id')
    @Roles('admin', 'teacher')
    @RequirePermission('quizzes.edit')
    @Audit('quizzes.topic_update', 'quiz_topic')
    public async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateQuizTopicDto) {
        return this.svc.update(id, dto);
    }

    @Delete(':id')
    @Roles('admin', 'teacher')
    @RequirePermission('quizzes.edit')
    @Audit('quizzes.topic_delete', 'quiz_topic')
    @HttpCode(HttpStatus.OK)
    public async remove(@Param('id', ParseIntPipe) id: number) {
        return this.svc.remove(id);
    }
}
