import { BadRequestException, Body, Controller, Delete, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { Audit } from '../../common/audit/audit.decorator';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { CreateTaskCommentDto } from './dto/create-task-comment.dto';
import { UpdateTaskCommentDto } from './dto/update-task-comment.dto';
import { TaskCommentsService } from './task-comments.service';

@Controller('admin-api/v1/admin/boards/:id/tasks/:tid/comments')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class BoardsTasksCommentsController {
    constructor(private readonly comments: TaskCommentsService) {}

    @Post()
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('tasks.comment')
    @Audit('task.comment.create', 'kanban_task_comment')
    public async create(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) boardId: number,
        @Param('tid') tid: string,
        @Body() dto: CreateTaskCommentDto,
    ) {
        return this.comments.create(actor, boardId, parseTid(tid), dto);
    }

    @Patch(':cmid')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('tasks.comment')
    @Audit('task.comment.update', 'kanban_task_comment')
    public async update(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) boardId: number,
        @Param('tid') tid: string,
        @Param('cmid') cmid: string,
        @Body() dto: UpdateTaskCommentDto,
    ) {
        return this.comments.update(actor, boardId, parseTid(tid), parseTid(cmid), dto);
    }

    @Delete(':cmid')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('tasks.comment')
    @Audit('task.comment.delete', 'kanban_task_comment')
    public async remove(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) boardId: number,
        @Param('tid') tid: string,
        @Param('cmid') cmid: string,
    ) {
        return this.comments.softDelete(actor, boardId, parseTid(tid), parseTid(cmid));
    }
}

function parseTid(raw: string): bigint {
    if (!/^[1-9]\d{0,18}$/.test(raw)) throw new BadRequestException('invalid_id');
    return BigInt(raw);
}
