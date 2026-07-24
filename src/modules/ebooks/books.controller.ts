import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Audit } from '../../common/audit/audit.decorator';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { CreateBookDto } from './dto/create-book.dto';
import { ListBooksDto } from './dto/list-books.dto';
import { PublishBookDto } from './dto/publish-book.dto';
import { UpdateBookDto } from './dto/update-book.dto';
import { BooksService } from './books.service';
import { BooksMutationsService } from './books-mutations.service';

/**
 * Phase 39/40 — ebooks (Book) admin CRUD.
 *
 * Routes:
 *   GET    /admin-api/v1/admin/ebooks              -> list         (ebooks.view)
 *   GET    /admin-api/v1/admin/ebooks/:id          -> detail       (ebooks.view)
 *   POST   /admin-api/v1/admin/ebooks              -> create       (ebooks.create)
 *   PATCH  /admin-api/v1/admin/ebooks/:id/publish  -> publish gate (ebooks.publish)
 *   PATCH  /admin-api/v1/admin/ebooks/:id          -> update       (ebooks.edit)
 *   DELETE /admin-api/v1/admin/ebooks/:id          -> soft-delete  (ebooks.delete)
 *
 * List returns the raw `{ rows, total, pageCount }` shape; detail + mutations wrap with
 * apiResponse. The `:id/publish` route is declared BEFORE the generic `:id` PATCH so the
 * more specific path wins.
 */
@Controller('admin-api/v1/admin/ebooks')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class BooksController {
    constructor(
        private readonly booksService: BooksService,
        private readonly mutations: BooksMutationsService,
    ) {}

    @Get()
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('ebooks.view')
    public async list(@CurrentUser() actor: AuthenticatedRequestUser, @Query() query: ListBooksDto) {
        return this.booksService.list({ id: actor.id, role_name: actor.role_name }, query);
    }

    @Get(':id')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('ebooks.view')
    public async detail(@CurrentUser() actor: AuthenticatedRequestUser, @Param('id', ParseIntPipe) id: number) {
        return this.booksService.detail({ id: actor.id, role_name: actor.role_name }, id);
    }

    @Post()
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('ebooks.create')
    @Audit('ebooks.create', 'book')
    public async create(@CurrentUser() actor: AuthenticatedRequestUser, @Body() dto: CreateBookDto) {
        return this.mutations.create({ id: actor.id, role_name: actor.role_name }, dto);
    }

    @Patch(':id/publish')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('ebooks.publish')
    @Audit('ebooks.publish', 'book')
    public async publish(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: PublishBookDto,
    ) {
        return this.mutations.publish({ id: actor.id, role_name: actor.role_name }, id, dto);
    }

    @Patch(':id')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('ebooks.edit')
    @Audit('ebooks.update', 'book')
    public async update(
        @CurrentUser() actor: AuthenticatedRequestUser,
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: UpdateBookDto,
    ) {
        return this.mutations.update({ id: actor.id, role_name: actor.role_name }, id, dto);
    }

    @Delete(':id')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('ebooks.delete')
    @Audit('ebooks.delete', 'book')
    @HttpCode(HttpStatus.OK)
    public async remove(@CurrentUser() actor: AuthenticatedRequestUser, @Param('id', ParseIntPipe) id: number) {
        return this.mutations.softDelete({ id: actor.id, role_name: actor.role_name }, id);
    }
}
