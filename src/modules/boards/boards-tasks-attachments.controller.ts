import { BadRequestException, Body, Controller, Delete, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { Audit } from '../../common/audit/audit.decorator';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { AddTaskAttachmentDto } from './dto/add-task-attachment.dto';
import { TaskAttachmentsService } from './task-attachments.service';

@Controller('admin-api/v1/admin/boards/:id/tasks/:tid/attachments')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class BoardsTasksAttachmentsController {
    constructor(private readonly attachments: TaskAttachmentsService) {}

    @Post()
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('tasks.edit')
    @Audit('task.attachment.add', 'kanban_task_attachment')
    public async add(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) boardId: number,
        @Param('tid') tid: string,
        @Body() dto: AddTaskAttachmentDto,
    ) {
        return this.attachments.add(actor, boardId, parseTid(tid), dto);
    }

    @Delete(':aid')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('tasks.edit')
    @Audit('task.attachment.remove', 'kanban_task_attachment')
    public async remove(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) boardId: number,
        @Param('tid') tid: string,
        @Param('aid', ParseIntPipe) aid: number,
    ) {
        return this.attachments.remove(actor, boardId, parseTid(tid), aid);
    }
}

function parseTid(raw: string): bigint {
    if (!/^[1-9]\d{0,18}$/.test(raw)) throw new BadRequestException('invalid_task_id');
    return BigInt(raw);
}
