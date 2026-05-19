import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, UseGuards } from '@nestjs/common';
import { Audit } from '../../common/audit/audit.decorator';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { BoardsService } from './boards.service';
import { UpdateBoardDto } from './dto/update-board.dto';

@Controller('admin-api/v1/admin/boards')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class BoardsDetailController {
    constructor(private readonly boardsService: BoardsService) {}

    @Get(':id')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('boards.view')
    public async detail(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
    ) {
        return this.boardsService.detail(actor, id);
    }

    @Patch(':id')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('boards.edit')
    @Audit('board.update', 'kanban_board')
    public async update(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: UpdateBoardDto,
    ) {
        return this.boardsService.update(actor, id, dto);
    }

    @Delete(':id')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('boards.delete')
    @Audit('board.delete', 'kanban_board')
    public async remove(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
    ) {
        return this.boardsService.softDelete(actor, id);
    }
}
