import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Audit } from '../../common/audit/audit.decorator';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ListQuizSubjectsDto } from './dto/list-quiz-subjects.dto';
import { UpsertQuizSubjectDto } from './dto/upsert-quiz-subject.dto';
import { QuizSubjectsService } from './quiz-subjects.service';

/**
 * Phase 43 — справочник предметов (ТЗ 3.2.2, 6.0).
 *
 * Routes:
 *   GET   /admin-api/v1/admin/quiz-subjects      -> list   (ebooks.view)
 *   POST  /admin-api/v1/admin/quiz-subjects      -> create (ebooks.edit)
 *   PATCH /admin-api/v1/admin/quiz-subjects/:id  -> rename (ebooks.edit)
 *
 * Живёт в модуле ebooks и переиспользует права `ebooks.*`: предмет книге назначает
 * тот же оператор, что и заполняет её карточку. Удаления нет — см. сервис.
 * List отдаёт `{ rows, total, pageCount }`, мутации — apiResponse.
 */
@Controller('admin-api/v1/admin/quiz-subjects')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class QuizSubjectsController {
    constructor(private readonly subjects: QuizSubjectsService) {}

    @Get()
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('ebooks.view')
    public async list(@Query() query: ListQuizSubjectsDto) {
        return this.subjects.list(query);
    }

    @Post()
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('ebooks.edit')
    @Audit('quiz-subjects.create', 'quiz-subject')
    public async create(@Body() dto: UpsertQuizSubjectDto) {
        return this.subjects.create(dto);
    }

    @Patch(':id')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('ebooks.edit')
    @Audit('quiz-subjects.update', 'quiz-subject')
    public async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpsertQuizSubjectDto) {
        return this.subjects.update(id, dto);
    }
}
