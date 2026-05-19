import { Body, Controller, Get, Param, ParseIntPipe, Put, UseGuards } from '@nestjs/common';
import { Audit } from '../../common/audit/audit.decorator';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { BoardMembersService } from './board-members.service';
import { SetBoardMembersDto } from './dto/set-board-members.dto';

@Controller('admin-api/v1/admin/boards/:id/members')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class BoardsMembersController {
    constructor(private readonly members: BoardMembersService) {}

    @Get()
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('boards.view')
    public async list(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) boardId: number,
    ) {
        return this.members.list(actor, boardId);
    }

    @Put()
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('boards.manage_members')
    @Audit('board.members.replace', 'kanban_board')
    public async replace(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) boardId: number,
        @Body() dto: SetBoardMembersDto,
    ) {
        return this.members.replace(actor, boardId, dto);
    }
}
