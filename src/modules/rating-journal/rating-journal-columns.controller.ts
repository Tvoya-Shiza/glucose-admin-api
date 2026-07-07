import { Body, Controller, Delete, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Audit } from '../../common/audit/audit.decorator';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { CreateColumnDto } from './dto/create-column.dto';
import { ReorderColumnsDto } from './dto/reorder-columns.dto';
import { UpdateColumnDto } from './dto/update-column.dto';
import { RatingJournalColumnsService } from './services/rating-journal-columns.service';
import { parseBigIntId } from './utils/ids';

/**
 * Custom/attendance column management (TZ 2.3: add / rename / change-max /
 * reorder / hide-show / delete). Static 'reorder' is declared BEFORE ':id'.
 */
@Controller('admin-api/v1/admin/rating-journal/columns')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class RatingJournalColumnsController {
    constructor(private readonly svc: RatingJournalColumnsService) {}

    @Post()
    @Roles('admin', 'curator')
    @RequirePermission('rating_journal.columns_manage')
    @Audit('rating_journal.column_create', 'rating_journal_column')
    public async create(@CurrentUser() actor: AuthenticatedRequestUser, @Body() dto: CreateColumnDto) {
        return this.svc.create({ id: actor.id, role_name: actor.role_name }, dto);
    }

    @Patch('reorder')
    @Roles('admin', 'curator')
    @RequirePermission('rating_journal.columns_manage')
    @Audit('rating_journal.column_reorder', 'rating_journal_column')
    public async reorder(@CurrentUser() actor: AuthenticatedRequestUser, @Body() dto: ReorderColumnsDto) {
        return this.svc.reorder({ id: actor.id, role_name: actor.role_name }, dto);
    }

    @Patch(':id')
    @Roles('admin', 'curator')
    @RequirePermission('rating_journal.columns_manage')
    @Audit('rating_journal.column_update', 'rating_journal_column')
    public async update(@CurrentUser() actor: AuthenticatedRequestUser, @Param('id') idRaw: string, @Body() dto: UpdateColumnDto) {
        return this.svc.update({ id: actor.id, role_name: actor.role_name }, parseBigIntId(idRaw), dto);
    }

    @Delete(':id')
    @Roles('admin', 'curator')
    @RequirePermission('rating_journal.columns_manage')
    @Audit('rating_journal.column_delete', 'rating_journal_column')
    @HttpCode(HttpStatus.OK)
    public async remove(@CurrentUser() actor: AuthenticatedRequestUser, @Param('id') idRaw: string) {
        return this.svc.remove({ id: actor.id, role_name: actor.role_name }, parseBigIntId(idRaw));
    }
}
