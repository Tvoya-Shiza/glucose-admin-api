import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Audit } from '../../common/audit/audit.decorator';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ListTrainerThemesDto } from './dto/list-trainer-themes.dto';
import { UpsertTrainerThemeDto } from './dto/upsert-trainer-theme.dto';
import { TrainerThemesService } from './trainer-themes.service';

/**
 * Phase 43 — справочник тем оформления тренажёра.
 *
 * Routes:
 *   GET   /admin-api/v1/admin/trainer-themes      -> list   (trainers.view)
 *   POST  /admin-api/v1/admin/trainer-themes      -> create (trainers.edit)
 *   PATCH /admin-api/v1/admin/trainer-themes/:id  -> update (trainers.edit)
 *
 * Переиспользует права `trainers.*`: темы заводит тот же оператор, что и сами
 * тренажёры, — новые коды означали бы ещё один раунд раздачи доступов на проде.
 * Удаления нет, см. сервис. List отдаёт `{ rows, total, pageCount }`, мутации —
 * apiResponse.
 */
@Controller('admin-api/v1/admin/trainer-themes')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class TrainerThemesController {
    constructor(private readonly themes: TrainerThemesService) {}

    @Get()
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('trainers.view')
    public async list(@Query() query: ListTrainerThemesDto) {
        return this.themes.list(query);
    }

    @Post()
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('trainers.edit')
    @Audit('trainer-themes.create', 'trainer-theme')
    public async create(@Body() dto: UpsertTrainerThemeDto) {
        return this.themes.create(dto);
    }

    @Patch(':id')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('trainers.edit')
    @Audit('trainer-themes.update', 'trainer-theme')
    public async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpsertTrainerThemeDto) {
        return this.themes.update(id, dto);
    }
}
