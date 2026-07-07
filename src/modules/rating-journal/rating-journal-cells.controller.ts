import { Body, Controller, Get, Patch, Query, UseGuards } from '@nestjs/common';
import { Audit } from '../../common/audit/audit.decorator';
import { RequirePermission } from '../access/decorators/require-permission.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { HistoryQueryDto } from './dto/history-query.dto';
import { UpsertCellDto } from './dto/upsert-cell.dto';
import { RatingJournalCellsService } from './services/rating-journal-cells.service';

/**
 * Inline cell editing (autosave, 0..max) + reset-to-auto (PATCH /cells) and the
 * edit-log read (GET /cells/history — admin-only via rating_journal.history_view).
 * Static 'history' is a distinct path — no ':id' collision.
 */
@Controller('admin-api/v1/admin/rating-journal/cells')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class RatingJournalCellsController {
    constructor(private readonly svc: RatingJournalCellsService) {}

    @Patch()
    @Roles('admin', 'curator')
    @RequirePermission('rating_journal.edit')
    @Audit('rating_journal.cell_update', 'rating_journal_cell')
    public async upsert(@CurrentUser() actor: AuthenticatedRequestUser, @Body() dto: UpsertCellDto) {
        return this.svc.upsert({ id: actor.id, role_name: actor.role_name }, dto);
    }

    @Get('history')
    @Roles('admin', 'curator')
    @RequirePermission('rating_journal.history_view')
    public async history(@CurrentUser() actor: AuthenticatedRequestUser, @Query() query: HistoryQueryDto) {
        return this.svc.history({ id: actor.id, role_name: actor.role_name }, query);
    }
}
