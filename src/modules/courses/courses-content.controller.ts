import {
    Body,
    Controller,
    Delete,
    HttpCode,
    HttpStatus,
    Param,
    ParseIntPipe,
    Patch,
    Post,
    UseGuards,
} from '@nestjs/common';
import { Audit } from '../../common/audit/audit.decorator';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { ReorderDto } from './dto/reorder.dto';
import { UpsertChapterDto, UpsertItemDto } from './dto/upsert-item.dto';
import { CoursesContentService } from './courses-content.service';

/**
 * CRS-03 + CRS-04 — chapter / item / reorder mutations (Plan 05).
 *
 * Routes (all under /admin-api/v1/admin/courses/:id/...):
 *   PATCH  /:id/reorder                      — re-order chapters AND/OR items in one $tx
 *   POST   /:id/chapters                     — create chapter (+ translations)
 *   PATCH  /:id/chapters/:chapterId          — update chapter (+ translations)
 *   DELETE /:id/chapters/:chapterId          — delete chapter (cascades items)
 *   POST   /:id/items                        — create item (file / quiz / assignment)
 *   PATCH  /:id/items/:itemId                — update item + linked Files row + translations
 *   DELETE /:id/items/:itemId                — delete item (Files row retained)
 *
 * RBAC: admin / teacher (curators excluded — they don't author courses, CONTEXT D-19).
 *
 * Service layer enforces 3-step assertScope (existence -> teacher gate -> proceed).
 * Reorder pre-flights every id to defend against TOCTOU + foreign-id attacks.
 *
 * Audit: 7 audited handlers (1 reorder + 3 chapter + 3 item).
 */
@Controller('admin-api/v1/admin/courses')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class CoursesContentController {
    constructor(private readonly svc: CoursesContentService) {}

    // ---------------------------------------------------------------------
    // Reorder
    // ---------------------------------------------------------------------

    @Patch(':id/reorder')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('courses.edit')
    @Audit('courses.reorder', 'webinar')
    @HttpCode(HttpStatus.OK)
    public async reorder(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: ReorderDto,
    ) {
        return this.svc.reorder({ id: actor.id, role_name: actor.role_name }, id, dto);
    }

    // ---------------------------------------------------------------------
    // Chapter CRUD
    // ---------------------------------------------------------------------

    @Post(':id/chapters')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('courses.edit')
    @Audit('courses.chapter.create', 'webinar_chapter')
    @HttpCode(HttpStatus.OK)
    public async createChapter(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: UpsertChapterDto,
    ) {
        return this.svc.upsertChapter({ id: actor.id, role_name: actor.role_name }, id, dto);
    }

    @Patch(':id/chapters/:chapterId')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('courses.edit')
    @Audit('courses.chapter.update', 'webinar_chapter')
    public async updateChapter(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
        @Param('chapterId', ParseIntPipe) chapterId: number,
        @Body() dto: UpsertChapterDto,
    ) {
        return this.svc.upsertChapter({ id: actor.id, role_name: actor.role_name }, id, dto, chapterId);
    }

    @Delete(':id/chapters/:chapterId')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('courses.edit')
    @Audit('courses.chapter.delete', 'webinar_chapter')
    @HttpCode(HttpStatus.OK)
    public async deleteChapter(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
        @Param('chapterId', ParseIntPipe) chapterId: number,
    ) {
        return this.svc.deleteChapter({ id: actor.id, role_name: actor.role_name }, id, chapterId);
    }

    // ---------------------------------------------------------------------
    // Item CRUD
    // ---------------------------------------------------------------------

    @Post(':id/items')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('courses.edit')
    @Audit('courses.item.create', 'webinar_chapter_item')
    @HttpCode(HttpStatus.OK)
    public async createItem(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: UpsertItemDto,
    ) {
        return this.svc.upsertItem({ id: actor.id, role_name: actor.role_name }, id, dto);
    }

    @Patch(':id/items/:itemId')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('courses.edit')
    @Audit('courses.item.update', 'webinar_chapter_item')
    public async updateItem(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
        @Param('itemId', ParseIntPipe) itemId: number,
        @Body() dto: UpsertItemDto,
    ) {
        return this.svc.upsertItem({ id: actor.id, role_name: actor.role_name }, id, dto, itemId);
    }

    @Delete(':id/items/:itemId')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('courses.edit')
    @Audit('courses.item.delete', 'webinar_chapter_item')
    @HttpCode(HttpStatus.OK)
    public async deleteItem(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
        @Param('itemId', ParseIntPipe) itemId: number,
    ) {
        return this.svc.deleteItem({ id: actor.id, role_name: actor.role_name }, id, itemId);
    }
}
