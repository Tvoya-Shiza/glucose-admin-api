import { BadRequestException, Body, Controller, Delete, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { Audit } from '../../common/audit/audit.decorator';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { CreateChecklistItemDto } from './dto/create-checklist-item.dto';
import { UpdateChecklistItemDto } from './dto/update-checklist-item.dto';
import { TaskChecklistService } from './task-checklist.service';

@Controller('admin-api/v1/admin/boards/:id/tasks/:tid/checklist')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class BoardsTasksChecklistController {
    constructor(private readonly checklist: TaskChecklistService) {}

    @Post()
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('tasks.edit')
    @Audit('task.checklist.create', 'kanban_task_checklist_item')
    public async create(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) boardId: number,
        @Param('tid') tid: string,
        @Body() dto: CreateChecklistItemDto,
    ) {
        return this.checklist.create(actor, boardId, parseTid(tid), dto);
    }

    @Patch(':ckid')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('tasks.edit')
    @Audit('task.checklist.update', 'kanban_task_checklist_item')
    public async update(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) boardId: number,
        @Param('tid') tid: string,
        @Param('ckid', ParseIntPipe) ckid: number,
        @Body() dto: UpdateChecklistItemDto,
    ) {
        return this.checklist.update(actor, boardId, parseTid(tid), ckid, dto);
    }

    @Delete(':ckid')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('tasks.edit')
    @Audit('task.checklist.delete', 'kanban_task_checklist_item')
    public async remove(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) boardId: number,
        @Param('tid') tid: string,
        @Param('ckid', ParseIntPipe) ckid: number,
    ) {
        return this.checklist.remove(actor, boardId, parseTid(tid), ckid);
    }
}

function parseTid(raw: string): bigint {
    if (!/^[1-9]\d{0,18}$/.test(raw)) throw new BadRequestException('invalid_task_id');
    return BigInt(raw);
}
