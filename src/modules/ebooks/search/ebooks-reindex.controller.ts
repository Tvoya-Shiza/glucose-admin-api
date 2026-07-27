import { Controller, HttpCode, HttpStatus, NotFoundException, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { Audit } from '../../../common/audit/audit.decorator';
import { apiResponse } from '../../../common/utils/api-response';
import { PrismaService } from '../../../prisma/prisma.service';
import { RequirePermission } from '../../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../../access/guards/permission.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { JwtGuard } from '../../auth/guards/jwt.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { EbooksSearchIndexService } from './search-index.service';

/**
 * Phase 39/40 — manual full rebuild of one book's Postgres search projection.
 *
 *   POST /admin-api/v1/admin/ebooks/:id/reindex   (ebooks.edit)
 *
 * Reads all pages from MySQL (source of truth) and rebuilds book_page_index. Best-effort:
 * when SEARCH_DATABASE_URL is unset or Postgres is down the call returns { ok:false, reason }
 * with HTTP 200 (indexing never blocks the admin) — it does not 500.
 */
@Controller('admin-api/v1/admin/ebooks')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class EbooksReindexController {
    constructor(
        private readonly prisma: PrismaService,
        private readonly searchIndex: EbooksSearchIndexService,
    ) {}

    @Post(':id/reindex')
    @Roles('admin', 'curator', 'teacher')
    @RequirePermission('ebooks.edit')
    @Audit('ebooks.reindex', 'book')
    @HttpCode(HttpStatus.OK)
    public async reindex(@Param('id', ParseIntPipe) id: number) {
        const book = await this.prisma.book.findUnique({ where: { id }, select: { id: true } });
        if (!book) throw new NotFoundException('ebooks.not_found');

        const result = await this.searchIndex.reindexBook(id);
        return apiResponse(1, 'ok', 'ebooks.reindexed', { id, ...result });
    }
}
