import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Put, UseGuards } from '@nestjs/common';
import { Audit } from '../../common/audit/audit.decorator';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ReplacePagesDto } from './dto/replace-pages.dto';
import { BookPagesService } from './book-pages.service';

/**
 * Phase 39/40 — book page management.
 *
 * Routes:
 *   GET    /admin-api/v1/admin/ebooks/:bookId/pages              -> list         (ebooks.view)
 *   PUT    /admin-api/v1/admin/ebooks/:bookId/pages              -> batch upsert (ebooks.pages_manage)
 *   DELETE /admin-api/v1/admin/ebooks/:bookId/pages/:pageNumber  -> remove one   (ebooks.pages_manage)
 *
 * Mutations wrap with apiResponse; the list returns `{ rows, total }`. Every mutation
 * recomputes books.page_count and (best-effort) syncs the Postgres search index.
 */
@Controller('admin-api/v1/admin/ebooks/:bookId/pages')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class BookPagesController {
    constructor(private readonly pages: BookPagesService) {}

    @Get()
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('ebooks.view')
    public async list(@Param('bookId', ParseIntPipe) bookId: number) {
        return this.pages.list(bookId);
    }

    @Put()
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('ebooks.pages_manage')
    @Audit('ebooks.pages_replace', 'book_page')
    public async replace(@Param('bookId', ParseIntPipe) bookId: number, @Body() dto: ReplacePagesDto) {
        return this.pages.replacePages(bookId, dto);
    }

    @Delete(':pageNumber')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('ebooks.pages_manage')
    @Audit('ebooks.page_delete', 'book_page')
    @HttpCode(HttpStatus.OK)
    public async remove(@Param('bookId', ParseIntPipe) bookId: number, @Param('pageNumber', ParseIntPipe) pageNumber: number) {
        return this.pages.removePage(bookId, pageNumber);
    }
}
