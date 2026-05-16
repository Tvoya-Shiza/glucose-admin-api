import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    ParseIntPipe,
    Patch,
    Post,
    UseGuards,
} from '@nestjs/common';
import { Audit } from '../../../common/audit/audit.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { JwtGuard } from '../../auth/guards/jwt.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../../auth/jwt/jwt.strategy';
import { CreateFolderDto } from './dto/create-folder.dto';
import { MoveFolderDto } from './dto/move-folder.dto';
import { RenameFolderDto } from './dto/rename-folder.dto';
import { FoldersService } from './folders.service';

/**
 * FoldersController — Phase 10. Media-library folder CRUD.
 *
 * Routes:
 *   GET    /admin-api/v1/admin/folders           (admin/teacher/curator)
 *   GET    /admin-api/v1/admin/folders/:id       (admin/teacher/curator)
 *   POST   /admin-api/v1/admin/folders           (admin/teacher) — create
 *   PATCH  /admin-api/v1/admin/folders/:id       (admin/teacher) — rename
 *   PATCH  /admin-api/v1/admin/folders/:id/move  (admin/teacher) — move
 *   DELETE /admin-api/v1/admin/folders/:id       (admin/teacher) — soft-delete (empty only)
 *
 * Curator is allowed to LIST folders (they need to navigate the file-library
 * UI) but cannot mutate the tree — matches the curator policy on uploads.
 */
@Controller('admin-api/v1/admin/folders')
export class FoldersController {
    constructor(private readonly service: FoldersService) {}

    @Get()
    @UseGuards(JwtGuard, RolesGuard)
    @Roles('admin', 'teacher', 'curator')
    public list() {
        return this.service.listFolders();
    }

    @Get(':id')
    @UseGuards(JwtGuard, RolesGuard)
    @Roles('admin', 'teacher', 'curator')
    public get(@Param('id', ParseIntPipe) id: number) {
        return this.service.getFolder(id);
    }

    @Post()
    @UseGuards(JwtGuard, RolesGuard)
    @Roles('admin', 'teacher')
    @Audit('folders.create', 'folder')
    @HttpCode(HttpStatus.CREATED)
    public create(@CurrentUser() actor: AuthenticatedRequestUser, @Body() dto: CreateFolderDto) {
        return this.service.createFolder(actor, dto);
    }

    @Patch(':id')
    @UseGuards(JwtGuard, RolesGuard)
    @Roles('admin', 'teacher')
    @Audit('folders.rename', 'folder')
    public rename(@Param('id', ParseIntPipe) id: number, @Body() dto: RenameFolderDto) {
        return this.service.renameFolder(id, dto);
    }

    @Patch(':id/move')
    @UseGuards(JwtGuard, RolesGuard)
    @Roles('admin', 'teacher')
    @Audit('folders.move', 'folder')
    public move(@Param('id', ParseIntPipe) id: number, @Body() dto: MoveFolderDto) {
        return this.service.moveFolder(id, dto);
    }

    @Delete(':id')
    @UseGuards(JwtGuard, RolesGuard)
    @Roles('admin', 'teacher')
    @Audit('folders.delete', 'folder')
    @HttpCode(HttpStatus.NO_CONTENT)
    public async remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
        await this.service.deleteFolder(id);
    }
}
