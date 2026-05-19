import { BadRequestException, Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { Audit } from '../../common/audit/audit.decorator';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { CreateTaskDto } from './dto/create-task.dto';
import { ListTasksDto } from './dto/list-tasks.dto';
import { MoveTaskDto } from './dto/move-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { TasksService } from './tasks.service';

/**
 * Task CRUD + drag-drop move.
 *
 * `:tid` is a `BIGINT UNSIGNED` (string-on-the-wire). `parseTid` rejects values
 * that don't fit a positive bigint, so the service never sees a NaN.
 */
@Controller('admin-api/v1/admin/boards/:id/tasks')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class BoardsTasksController {
    constructor(private readonly tasks: TasksService) {}

    @Get()
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('tasks.view')
    public async list(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) boardId: number,
        @Query() query: ListTasksDto,
    ) {
        return this.tasks.list(actor, boardId, query);
    }

    @Post()
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('tasks.create')
    @Audit('task.create', 'kanban_task')
    public async create(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) boardId: number,
        @Body() dto: CreateTaskDto,
    ) {
        return this.tasks.create(actor, boardId, dto);
    }

    @Get(':tid')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('tasks.view')
    public async detail(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) boardId: number,
        @Param('tid') tid: string,
    ) {
        return this.tasks.detail(actor, boardId, parseTid(tid));
    }

    @Patch(':tid')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('tasks.edit')
    @Audit('task.update', 'kanban_task')
    public async update(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) boardId: number,
        @Param('tid') tid: string,
        @Body() dto: UpdateTaskDto,
    ) {
        return this.tasks.update(actor, boardId, parseTid(tid), dto);
    }

    @Put(':tid/move')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('tasks.edit')
    @Audit('task.move', 'kanban_task')
    public async move(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) boardId: number,
        @Param('tid') tid: string,
        @Body() dto: MoveTaskDto,
    ) {
        return this.tasks.move(actor, boardId, parseTid(tid), dto);
    }

    @Delete(':tid')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('tasks.delete')
    @Audit('task.delete', 'kanban_task')
    public async remove(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) boardId: number,
        @Param('tid') tid: string,
    ) {
        return this.tasks.softDelete(actor, boardId, parseTid(tid));
    }
}

function parseTid(raw: string): bigint {
    if (!/^[1-9]\d{0,18}$/.test(raw)) throw new BadRequestException('invalid_task_id');
    return BigInt(raw);
}
