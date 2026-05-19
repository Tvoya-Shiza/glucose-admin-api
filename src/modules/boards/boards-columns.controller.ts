import { Body, Controller, Delete, Param, ParseIntPipe, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { Audit } from '../../common/audit/audit.decorator';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { ColumnsService } from './columns.service';
import { CreateColumnDto } from './dto/create-column.dto';
import { ReorderColumnsDto } from './dto/reorder-columns.dto';
import { UpdateColumnDto } from './dto/update-column.dto';

@Controller('admin-api/v1/admin/boards/:id/columns')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class BoardsColumnsController {
    constructor(private readonly columns: ColumnsService) {}

    @Post()
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('boards.manage_columns')
    @Audit('board.column.create', 'kanban_column')
    public async create(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) boardId: number,
        @Body() dto: CreateColumnDto,
    ) {
        return this.columns.create(actor, boardId, dto);
    }

    @Patch(':cid')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('boards.manage_columns')
    @Audit('board.column.update', 'kanban_column')
    public async update(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) boardId: number,
        @Param('cid', ParseIntPipe) columnId: number,
        @Body() dto: UpdateColumnDto,
    ) {
        return this.columns.update(actor, boardId, columnId, dto);
    }

    @Delete(':cid')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('boards.manage_columns')
    @Audit('board.column.delete', 'kanban_column')
    public async remove(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) boardId: number,
        @Param('cid', ParseIntPipe) columnId: number,
    ) {
        return this.columns.softDelete(actor, boardId, columnId);
    }

    @Put('reorder')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('boards.manage_columns')
    @Audit('board.column.reorder', 'kanban_column')
    public async reorder(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) boardId: number,
        @Body() dto: ReorderColumnsDto,
    ) {
        return this.columns.reorder(actor, boardId, dto);
    }
}
