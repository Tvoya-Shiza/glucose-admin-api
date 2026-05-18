import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { ListResultsDto } from './dto/list-results.dto';
import { QuizzesResultsService } from './quizzes-results.service';

/**
 * QZ-08 + QZ-09 — GET /admin-api/v1/admin/quiz-results (Plan 07).
 *
 * Returns the raw `{ rows, total, page, page_size }` shape (NOT wrapped in
 * apiResponse) per glucose-admin-api/CLAUDE.md "List endpoints (Phase 3+)
 * return raw — TanStack Table on the admin-client consumes the raw shape."
 *
 * Audit: GET endpoints are exempt from the `npm run ci:audit-required` lint
 * (the CLI walks src/modules/**\/*.controller.ts via TypeScript compiler API
 * and only checks non-GET handlers). No `@Audit` / `@SkipAudit` needed.
 *
 * RBAC (CONTEXT D-22):
 *   - admin   → all results
 *   - curator → buildScopeWhere narrows to results from users in their group
 *   - teacher → MANUAL two-step lookup in service: webinar_id IN (own webinars)
 *
 * The service is the source of truth for scope narrowing; this controller is
 * a thin pass-through.
 */
@Controller('admin-api/v1/admin/quiz-results')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class QuizzesResultsController {
    constructor(private readonly svc: QuizzesResultsService) {}

    @Get()
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('quizzes.results_view')
    public async listResults(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Query() filters: ListResultsDto,
    ) {
        return this.svc.listResults({ id: actor.id, role_name: actor.role_name }, filters);
    }
}
