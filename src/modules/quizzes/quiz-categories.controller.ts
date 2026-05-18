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
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UpsertCategoryDto } from './dto/upsert-category.dto';
import { QuizCategoriesService } from './quiz-categories.service';

/**
 * QZ-04 — QuizCategory tree CRUD (Phase 6 Plan 03).
 *
 * Routes:
 *   GET    /admin-api/v1/admin/quiz-categories          -> list (admin/curator/teacher)
 *   POST   /admin-api/v1/admin/quiz-categories          -> create (admin only)
 *   PATCH  /admin-api/v1/admin/quiz-categories/:id      -> update (admin only)
 *   DELETE /admin-api/v1/admin/quiz-categories/:id      -> delete (admin only) ?force=true|false
 *
 * RBAC posture (D-21 — categories are admin-only data; no per-actor scope):
 *   - List is open to admin/curator/teacher because Plan 02's quiz filter selector
 *     consumes this endpoint and curators/teachers must populate the dropdown.
 *   - All mutations are @Roles('admin') — default-deny posture for organizational
 *     structure changes (T-06-33).
 *
 * Audit (T-06-15 / T-06-34):
 *   Every non-GET handler carries @Audit. CI lint `npm run ci:audit-required`
 *   walks every controller and gates on this decoration.
 */
@Controller('admin-api/v1/admin/quiz-categories')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class QuizCategoriesController {
    constructor(private readonly svc: QuizCategoriesService) {}

    @Get()
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('quizzes.view')
    public async list() {
        return this.svc.listAll();
    }

    @Post()
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('quizzes.categories_manage')
    @Audit('quiz_categories.create', 'quiz_category')
    public async create(@Body() dto: UpsertCategoryDto) {
        return this.svc.create(dto);
    }

    @Patch(':id')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('quizzes.categories_manage')
    @Audit('quiz_categories.update', 'quiz_category')
    public async update(
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: UpsertCategoryDto,
    ) {
        return this.svc.update(id, dto);
    }

    @Delete(':id')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('quizzes.categories_manage')
    @Audit('quiz_categories.delete', 'quiz_category')
    @HttpCode(HttpStatus.OK)
    public async remove(
        @Param('id', ParseIntPipe) id: number,
        @Query('force') force?: string,
    ) {
        const forceBool = force === 'true' || force === '1';
        return this.svc.remove(id, forceBool);
    }
}
