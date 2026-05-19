import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { Audit } from '../../common/audit/audit.decorator';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { BoardsListService } from './boards-list.service';
import { BoardsService } from './boards.service';
import { CreateBoardDto } from './dto/create-board.dto';
import { ListBoardsDto } from './dto/list-boards.dto';

/**
 * GET / list boards visible to the actor; POST / create.
 * RBAC: admin / curator / teacher / any custom role with the right permission.
 */
@Controller('admin-api/v1/admin/boards')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class BoardsListController {
    constructor(
        private readonly listService: BoardsListService,
        private readonly boardsService: BoardsService,
    ) {}

    @Get()
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('boards.view')
    public async list(@CurrentUser() actor: AuthenticatedRequestUser, @Query() query: ListBoardsDto) {
        return this.listService.list(actor, query);
    }

    @Post()
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('boards.create')
    @Audit('board.create', 'kanban_board')
    public async create(@CurrentUser() actor: AuthenticatedRequestUser, @Body() dto: CreateBoardDto) {
        return this.boardsService.create(actor, dto);
    }
}
