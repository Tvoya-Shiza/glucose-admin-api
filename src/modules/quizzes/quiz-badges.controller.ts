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
    UseGuards,
} from '@nestjs/common';
import { Audit } from '../../common/audit/audit.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UpsertBadgeDto } from './dto/upsert-badge.dto';
import { QuizBadgesService } from './quiz-badges.service';

/**
 * QZ-05 — QuizBadge ("Пробное ЕНТ") CRUD (Phase 6 Plan 06).
 *
 * Routes:
 *   GET    /admin-api/v1/admin/quiz-badges          -> list (admin/curator/teacher)
 *   GET    /admin-api/v1/admin/quiz-badges/:id      -> detail (admin/curator/teacher)
 *   POST   /admin-api/v1/admin/quiz-badges          -> create (admin only)
 *   PATCH  /admin-api/v1/admin/quiz-badges/:id      -> update (admin only)
 *   DELETE /admin-api/v1/admin/quiz-badges/:id      -> soft-delete via is_active=false (admin only)
 *
 * RBAC posture (D-21 — badges are admin-only authoring; teachers/curators may VIEW
 * for the badge filter dropdown in Plan 02 list page and badge selectors elsewhere).
 *
 * Audit (T-06-15 / T-06-76):
 *   Every non-GET handler carries @Audit. CI lint `npm run ci:audit-required`
 *   walks every controller and gates on this decoration.
 */
@Controller('admin-api/v1/admin/quiz-badges')
@UseGuards(JwtGuard, RolesGuard)
export class QuizBadgesController {
    constructor(private readonly svc: QuizBadgesService) {}

    @Get()
    @Roles('admin', 'curator', 'teacher')
    public async list() {
        return this.svc.listAll();
    }

    @Get(':id')
    @Roles('admin', 'curator', 'teacher')
    public async detail(@Param('id', ParseIntPipe) id: number) {
        return this.svc.getDetail(id);
    }

    @Post()
    @Roles('admin')
    @Audit('quiz_badges.create', 'quiz_badge')
    public async create(@Body() dto: UpsertBadgeDto) {
        return this.svc.create(dto);
    }

    @Patch(':id')
    @Roles('admin')
    @Audit('quiz_badges.update', 'quiz_badge')
    public async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpsertBadgeDto) {
        return this.svc.update(id, dto);
    }

    @Delete(':id')
    @Roles('admin')
    @Audit('quiz_badges.delete', 'quiz_badge')
    @HttpCode(HttpStatus.OK)
    public async remove(@Param('id', ParseIntPipe) id: number) {
        return this.svc.softDelete(id);
    }
}
