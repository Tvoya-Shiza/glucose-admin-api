import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { ListQuizzesDto } from './dto/list-quizzes.dto';
import { QuizzesListService } from './quizzes-list.service';

/**
 * QZ-01 — GET /admin-api/v1/admin/quizzes (Plan 02).
 *
 * Returns the raw QuizListResponseDto shape (NOT wrapped in apiResponse) per
 * glucose-admin-api/CLAUDE.md "List endpoints (Phase 3+) return `{ rows, total, ... }`
 * directly — TanStack Table on the admin-client consumes the raw shape."
 *
 * Audit: GET endpoints are exempt from the @Audit lint — no decorator needed.
 *
 * RBAC: admin / curator / teacher all hit the route (mirrors Phase 5 courses
 * pattern). QUIZ_SCOPE_RULES narrows visibility:
 *   - admin   -> all quizzes
 *   - teacher -> all quizzes (D-21: teacher edits ANY quiz)
 *   - curator -> default-deny (id: { in: [] }) -> empty result
 *
 * Curators are kept on the route so any future "no quizzes" empty-state for
 * curators continues to render a real 200 response.
 */
@Controller('admin-api/v1/admin/quizzes')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class QuizzesListController {
    constructor(private readonly listService: QuizzesListService) {}

    @Get()
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('quizzes.view')
    public async list(@CurrentUser() actor: AuthenticatedRequestUser, @Query() query: ListQuizzesDto) {
        return this.listService.list({ id: actor.id, role_name: actor.role_name }, query);
    }
}
