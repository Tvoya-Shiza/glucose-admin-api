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
    Query,
    UseGuards,
} from '@nestjs/common';
import { Audit } from '../../common/audit/audit.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { UpsertAnswerDto } from './dto/upsert-answer.dto';
import { QuizzesAnswersService } from './quizzes-answers.service';

/**
 * QZ-02 / QZ-06 — admin/teacher answer CRUD (Phase 6 Plan 05).
 *
 * Routes (all under /admin-api/v1/admin/quizzes/:quizId/questions/:questionId/answers):
 *
 *   POST   ''            -> create answer    (admin/teacher; NOT destructive — additive)
 *   PATCH  ':answerId'   -> update answer    (admin/teacher; destructive gate on title/correct/parent_id)
 *   DELETE ':answerId'   -> delete answer    (admin/teacher; destructive gate)
 *
 * For identificative pairs (D-07):
 *   - POST with parent_id=null  → LEFT-side anchor row
 *   - POST with parent_id=<id>  → RIGHT-side match row pointing at LEFT
 *   - DELETE on LEFT row        → cascades RIGHT children via schema FK (single
 *                                 audit row + single version bump per pair removal)
 *
 * Audit (T-06-15): every mutation handler decorated.
 */
@Controller('admin-api/v1/admin/quizzes/:quizId/questions/:questionId/answers')
@UseGuards(JwtGuard, RolesGuard)
export class QuizzesAnswersController {
    constructor(private readonly svc: QuizzesAnswersService) {}

    @Post()
    @Roles('admin', 'teacher')
    @Audit('quizzes.answer.create', 'quiz_answer')
    public async create(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('quizId', ParseIntPipe) quizId: number,
        @Param('questionId', ParseIntPipe) questionId: number,
        @Body() dto: UpsertAnswerDto,
    ) {
        return this.svc.createAnswer(
            { id: actor.id, role_name: actor.role_name },
            quizId,
            questionId,
            dto,
        );
    }

    @Patch(':answerId')
    @Roles('admin', 'teacher')
    @Audit('quizzes.answer.update', 'quiz_answer')
    public async update(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('quizId', ParseIntPipe) quizId: number,
        @Param('questionId', ParseIntPipe) questionId: number,
        @Param('answerId', ParseIntPipe) answerId: number,
        @Body() dto: UpsertAnswerDto,
    ) {
        return this.svc.updateAnswer(
            { id: actor.id, role_name: actor.role_name },
            quizId,
            questionId,
            answerId,
            dto,
        );
    }

    @Delete(':answerId')
    @Roles('admin', 'teacher')
    @Audit('quizzes.answer.delete', 'quiz_answer')
    @HttpCode(HttpStatus.OK)
    public async remove(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('quizId', ParseIntPipe) quizId: number,
        @Param('questionId', ParseIntPipe) questionId: number,
        @Param('answerId', ParseIntPipe) answerId: number,
        @Query('force_confirm_token') forceConfirmToken?: string,
    ) {
        return this.svc.deleteAnswer(
            { id: actor.id, role_name: actor.role_name },
            quizId,
            questionId,
            answerId,
            forceConfirmToken ?? null,
        );
    }
}
