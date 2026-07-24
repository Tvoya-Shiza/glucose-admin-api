import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Audit } from '../../common/audit/audit.decorator';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ListPublishersDto } from './dto/list-publishers.dto';
import { UpsertPublisherDto } from './dto/upsert-publisher.dto';
import { PublishersService } from './publishers.service';

/**
 * Phase 39/40 — Publishers admin CRUD (content library reference entity).
 *
 * Routes:
 *   GET    /admin-api/v1/admin/publishers      -> list   (ebooks.view)
 *   POST   /admin-api/v1/admin/publishers      -> create (ebooks.edit)
 *   PATCH  /admin-api/v1/admin/publishers/:id  -> update (ebooks.edit)
 *   DELETE /admin-api/v1/admin/publishers/:id  -> delete (ebooks.edit; FK SET NULL)
 *
 * List returns the raw `{ rows, total, pageCount }` shape; mutations wrap with apiResponse.
 * Publishers reuse the `ebooks.*` permission group (no separate publisher permission).
 */
@Controller('admin-api/v1/admin/publishers')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class PublishersController {
    constructor(private readonly publishers: PublishersService) {}

    @Get()
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('ebooks.view')
    public async list(@Query() query: ListPublishersDto) {
        return this.publishers.list(query);
    }

    @Post()
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('ebooks.edit')
    @Audit('publishers.create', 'publisher')
    public async create(@Body() dto: UpsertPublisherDto) {
        return this.publishers.create(dto);
    }

    @Patch(':id')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('ebooks.edit')
    @Audit('publishers.update', 'publisher')
    public async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpsertPublisherDto) {
        return this.publishers.update(id, dto);
    }

    @Delete(':id')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('ebooks.edit')
    @Audit('publishers.delete', 'publisher')
    @HttpCode(HttpStatus.OK)
    public async remove(@Param('id', ParseIntPipe) id: number) {
        return this.publishers.remove(id);
    }
}
