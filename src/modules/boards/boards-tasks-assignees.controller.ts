import { BadRequestException, Body, Controller, Param, ParseIntPipe, Put, UseGuards } from '@nestjs/common';
import { Audit } from '../../common/audit/audit.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { BoardAccessService } from './board-access.service';
import { SetTaskAssigneesDto } from './dto/set-task-assignees.dto';
import { TaskActivityService } from './task-activity.service';
import { TaskAssigneesService } from './task-assignees.service';
import { TaskEventNotifierService } from './task-event-notifier.service';

@Controller('admin-api/v1/admin/boards/:id/tasks/:tid/assignees')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class BoardsTasksAssigneesController {
    constructor(
        private readonly access: BoardAccessService,
        private readonly assignees: TaskAssigneesService,
        private readonly activity: TaskActivityService,
        private readonly notifier: TaskEventNotifierService,
        private readonly prisma: PrismaService,
    ) {}

    @Put()
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('tasks.assign')
    @Audit('task.assignees.replace', 'kanban_task')
    public async replace(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) boardId: number,
        @Param('tid') tid: string,
        @Body() dto: SetTaskAssigneesDto,
    ) {
        await this.access.assertEditor(actor, boardId);
        const taskId = parseTid(tid);

        // Capture the previous assignee set so we can notify only NEW users.
        const previous = new Set(await this.assignees.expandAssigneesToUserIds(taskId));
        await this.assignees.replaceAndCommit(taskId, actor.id, dto);
        await this.activity.log(this.prisma, taskId, actor.id, 'assignee_added', {
            count: dto.assignees.length,
        });

        const next = await this.assignees.expandAssigneesToUserIds(taskId);
        const added = next.filter((id) => !previous.has(id));
        if (added.length > 0) {
            const task = await this.prisma.kanbanTask.findUnique({
                where: { id: taskId },
                select: { title: true },
            });
            await this.notifier.notifyTaskAssigned({
                taskId,
                boardId,
                title: task?.title ?? '',
                actorId: actor.id,
                recipientUserIds: added,
            });
        }

        return { ok: true, rows: await this.assignees.list(taskId) };
    }
}

function parseTid(raw: string): bigint {
    if (!/^[1-9]\d{0,18}$/.test(raw)) throw new BadRequestException('invalid_task_id');
    return BigInt(raw);
}
