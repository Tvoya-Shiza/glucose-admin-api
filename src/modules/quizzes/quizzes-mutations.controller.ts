import {
    Body,
    Controller,
    Delete,
    HttpCode,
    HttpStatus,
    Param,
    ParseIntPipe,
    Patch,
    Post,
    UseGuards,
} from '@nestjs/common';
import { Audit } from '../../common/audit/audit.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { CreateQuizDto } from './dto/create-quiz.dto';
import { UpdateQuizDto } from './dto/update-quiz.dto';
import { QuizzesMutationsService } from './quizzes-mutations.service';

/**
 * QZ-01 / QZ-08 — admin/teacher quiz mutations (Plan 02).
 *
 * Routes:
 *   POST   /admin-api/v1/admin/quizzes        -> create        (admin / teacher)
 *   PATCH  /admin-api/v1/admin/quizzes/:id    -> update fields (admin / teacher per D-21)
 *   DELETE /admin-api/v1/admin/quizzes/:id    -> soft-delete   (admin only — teacher
 *                                                cannot delete per safe default)
 *
 * RBAC:
 *   - Curators are excluded at the @Roles decorator (D-21 — curators don't author).
 *   - Teachers may create / update any quiz (D-21 user spec — VERY PERMISSIVE).
 *   - Teachers may NOT delete (D-21 safe default — admin-only destructive lifecycle action).
 *
 * Audit (T-06-15): every handler decorated. CI lint enforces this on non-GET endpoints.
 */
@Controller('admin-api/v1/admin/quizzes')
@UseGuards(JwtGuard, RolesGuard)
export class QuizzesMutationsController {
    constructor(private readonly svc: QuizzesMutationsService) {}

    @Post()
    @Roles('admin', 'teacher')
    @Audit('quizzes.create', 'quiz')
    public async create(@CurrentUser() actor: AuthenticatedRequestUser, @Body() dto: CreateQuizDto) {
        return this.svc.create({ id: actor.id, role_name: actor.role_name }, dto);
    }

    @Patch(':id')
    @Roles('admin', 'teacher')
    @Audit('quizzes.update', 'quiz')
    public async update(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: UpdateQuizDto,
    ) {
        return this.svc.update({ id: actor.id, role_name: actor.role_name }, id, dto);
    }

    @Delete(':id')
    @Roles('admin')
    @Audit('quizzes.delete', 'quiz')
    @HttpCode(HttpStatus.OK)
    public async remove(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
    ) {
        return this.svc.softDelete({ id: actor.id, role_name: actor.role_name }, id);
    }
}
