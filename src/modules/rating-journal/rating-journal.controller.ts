import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Audit } from '../../common/audit/audit.decorator';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { CreateJournalDto } from './dto/create-journal.dto';
import { GridQueryDto } from './dto/grid-query.dto';
import { ListJournalsDto } from './dto/list-journals.dto';
import { RatingJournalService } from './services/rating-journal.service';
import { parseBigIntId } from './utils/ids';

/**
 * «Рейтинг-журнал» — journal grid + list + explicit sync (Phase 35).
 * Grid GET resolves-or-creates the (group, course) journal and auto-syncs
 * module columns. Scoping: admin all; curator own groups; teacher denied.
 */
@Controller('admin-api/v1/admin/rating-journal')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class RatingJournalController {
    constructor(private readonly svc: RatingJournalService) {}

    /** Full grid for a (group, course) pair — static 'grid' precedes ':id'. */
    @Get('grid')
    @Roles('admin', 'curator')
    @RequirePermission('rating_journal.view')
    public async grid(@CurrentUser() actor: AuthenticatedRequestUser, @Query() query: GridQueryDto) {
        return this.svc.getGrid({ id: actor.id, role_name: actor.role_name }, query);
    }

    @Get()
    @Roles('admin', 'curator')
    @RequirePermission('rating_journal.view')
    public async list(@CurrentUser() actor: AuthenticatedRequestUser, @Query() query: ListJournalsDto) {
        return this.svc.listJournals({ id: actor.id, role_name: actor.role_name }, query);
    }

    @Post()
    @Roles('admin', 'curator')
    @RequirePermission('rating_journal.view')
    @Audit('rating_journal.create', 'rating_journal')
    public async create(@CurrentUser() actor: AuthenticatedRequestUser, @Body() dto: CreateJournalDto) {
        return this.svc.createJournal({ id: actor.id, role_name: actor.role_name }, dto);
    }

    @Post(':id/sync')
    @Roles('admin', 'curator')
    @RequirePermission('rating_journal.view')
    @Audit('rating_journal.sync', 'rating_journal')
    @HttpCode(HttpStatus.OK)
    public async sync(@CurrentUser() actor: AuthenticatedRequestUser, @Param('id') idRaw: string) {
        return this.svc.syncJournal({ id: actor.id, role_name: actor.role_name }, parseBigIntId(idRaw));
    }
}
