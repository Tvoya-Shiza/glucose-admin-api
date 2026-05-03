import { Controller, HttpCode, HttpStatus, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { Audit } from '../../common/audit/audit.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { QuizzesDuplicateService } from './quizzes-duplicate.service';

/**
 * QZ-07 — POST /admin-api/v1/admin/quizzes/:id/duplicate (Plan 02).
 *
 * Routed in its own controller (not folded into mutations) per Plan 02 file-layout
 * convention: one controller per concern. Future Plan 05 question/answer mutations
 * land in their own controller; Plan 04 detail in another. Keeps each controller
 * narrowly typed and the audit decorator coverage trivially auditable.
 *
 * RBAC: admin / teacher (D-21 — teacher can duplicate any quiz). Curator excluded
 * at @Roles. The service layer also has a defensive curator -> 403.
 *
 * Audit: @Audit('quizzes.duplicate', 'quiz') — meta richer than entity_id alone
 * (questions_copied / answers_copied / orphan_remaps). The interceptor reads
 * entity_id from `response.data.id` (apiResponse-wrapped); the rest of the payload
 * shows up in the response body for human review.
 */
@Controller('admin-api/v1/admin/quizzes')
@UseGuards(JwtGuard, RolesGuard)
export class QuizzesDuplicateController {
    constructor(private readonly svc: QuizzesDuplicateService) {}

    @Post(':id/duplicate')
    @Roles('admin', 'teacher')
    @Audit('quizzes.duplicate', 'quiz')
    @HttpCode(HttpStatus.OK)
    public async duplicate(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
    ) {
        return this.svc.duplicate({ id: actor.id, role_name: actor.role_name }, id);
    }
}
