import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Audit } from '../../common/audit/audit.decorator';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { CreateTrainerDto } from './dto/create-trainer.dto';
import { ListTrainersDto } from './dto/list-trainers.dto';
import { PublishTrainerDto } from './dto/publish-trainer.dto';
import { UpdateTrainerDto } from './dto/update-trainer.dto';
import { TrainersMutationsService } from './trainers-mutations.service';
import { TrainersService } from './trainers.service';

/**
 * Phase 38 — «Тренажёр» admin CRUD.
 *
 * Routes:
 *   GET    /admin-api/v1/admin/trainers              -> list         (trainers.view)
 *   GET    /admin-api/v1/admin/trainers/:id          -> detail       (trainers.view)
 *   POST   /admin-api/v1/admin/trainers              -> create       (trainers.create)
 *   PATCH  /admin-api/v1/admin/trainers/:id          -> update       (trainers.edit)
 *   DELETE /admin-api/v1/admin/trainers/:id          -> soft-delete  (trainers.delete)
 *   PATCH  /admin-api/v1/admin/trainers/:id/publish  -> publish/hide (trainers.publish)
 *
 * List returns the raw `{ rows, total, pageCount }` shape (NOT wrapped in apiResponse)
 * per glucose-admin-api/CLAUDE.md; detail + mutations wrap with apiResponse.
 *
 * RBAC: runtime-driven — every route lists admin/curator/teacher in @Roles and gates
 * on a grantable @RequirePermission('trainers.*'). No role is hardcoded below @Roles.
 *
 * Audit: every non-GET handler decorated (CI lint `npm run ci:audit-required`).
 * Entity is 'quiz' — a trainer IS a quizzes row (kind='trainer').
 *
 * Question/answer routes are intentionally ABSENT — the existing
 * /admin-api/v1/admin/quizzes/:quizId/questions* surface already serves trainers.
 */
@Controller('admin-api/v1/admin/trainers')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class TrainersController {
    constructor(
        private readonly trainersService: TrainersService,
        private readonly mutations: TrainersMutationsService,
    ) {}

    @Get()
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('trainers.view')
    public async list(@CurrentUser() actor: AuthenticatedRequestUser, @Query() query: ListTrainersDto) {
        return this.trainersService.list({ id: actor.id, role_name: actor.role_name }, query);
    }

    @Get(':id')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('trainers.view')
    public async detail(@CurrentUser() actor: AuthenticatedRequestUser, @Param('id', ParseIntPipe) id: number) {
        return this.trainersService.detail({ id: actor.id, role_name: actor.role_name }, id);
    }

    @Post()
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('trainers.create')
    @Audit('trainers.create', 'quiz')
    public async create(@CurrentUser() actor: AuthenticatedRequestUser, @Body() dto: CreateTrainerDto) {
        return this.mutations.create({ id: actor.id, role_name: actor.role_name }, dto);
    }

    @Patch(':id/publish')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('trainers.publish')
    @Audit('trainers.publish', 'quiz')
    public async publish(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: PublishTrainerDto,
    ) {
        return this.mutations.publish({ id: actor.id, role_name: actor.role_name }, id, dto);
    }

    @Patch(':id')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('trainers.edit')
    @Audit('trainers.update', 'quiz')
    public async update(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: UpdateTrainerDto,
    ) {
        return this.mutations.update({ id: actor.id, role_name: actor.role_name }, id, dto);
    }

    @Delete(':id')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('trainers.delete')
    @Audit('trainers.delete', 'quiz')
    @HttpCode(HttpStatus.OK)
    public async remove(@CurrentUser() actor: AuthenticatedRequestUser, @Param('id', ParseIntPipe) id: number) {
        return this.mutations.softDelete({ id: actor.id, role_name: actor.role_name }, id);
    }
}
