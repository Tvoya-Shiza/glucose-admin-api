import { Controller, Get, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { QuizzesDetailService } from './quizzes-detail.service';

/**
 * QZ-01 + QZ-08 — GET /admin-api/v1/admin/quizzes/:id (Plan 04).
 *
 * RBAC: admin / curator / teacher hit the route; the service layer enforces the
 * 403-not-404 distinction (CONTEXT D-21 + Plan 01 QUIZ_SCOPE_RULES). Mirrors
 * Phase 5 Plan 03 CoursesDetailController posture verbatim, with quiz-specific
 * semantics:
 *   - admin              → 200 (sees all)
 *   - teacher            → 200 (D-21: teacher can edit ANY quiz/test — VERY PERMISSIVE)
 *   - curator            → 403 'quizzes.forbidden_scope' (default-deny per
 *                           QUIZ_SCOPE_RULES.curator)
 *
 * 404 is reserved for "quiz genuinely does not exist" (existence check first, then
 * scope check). See QuizzesDetailService header for the rationale.
 *
 * Audit posture: GET endpoints are exempt from the @Audit lint — no decorator needed.
 *
 * Note: `curator` is included in @Roles for surface uniformity. Curators always hit
 * the ForbiddenException branch in service code because QUIZ_SCOPE_RULES.curator is
 * default-deny — same effective outcome (403) as a Phase 5 foreign-teacher would get
 * on a course they don't own.
 */
@Controller('admin-api/v1/admin/quizzes')
@UseGuards(JwtGuard, RolesGuard)
export class QuizzesDetailController {
    constructor(private readonly svc: QuizzesDetailService) {}

    @Get(':id')
    @Roles('admin', 'curator', 'teacher')
    public async getDetail(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
    ) {
        return this.svc.getDetail({ id: actor.id, role_name: actor.role_name }, id);
    }
}
