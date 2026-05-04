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
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UpsertBadgeItemDto } from './dto/upsert-badge-item.dto';
import { ReorderBadgeItemsDto } from './dto/reorder-badge-items.dto';
import { QuizBadgeItemsService } from './quiz-badge-items.service';

/**
 * QZ-05 — QuizBadgeItem (member quizzes inside a Пробное ЕНТ) management
 * (Phase 6 Plan 06).
 *
 * Routes:
 *   POST   /admin-api/v1/admin/quiz-badges/:badgeId/items                  -> add quiz to badge
 *   PATCH  /admin-api/v1/admin/quiz-badges/:badgeId/items/reorder          -> batch reorder
 *   DELETE /admin-api/v1/admin/quiz-badges/:badgeId/items/:itemId          -> remove item
 *
 * RBAC: admin only — D-21 grants edit access only to admins for badge management.
 *
 * Audit: every handler carries @Audit('quiz_badges.item.<verb>', 'quiz_badge_item').
 *
 * Threat mitigations baked in (service):
 *   - T-06-71: addItem validates quiz_id exists.
 *   - T-06-72: addItem rejects duplicate (badge_id, quiz_id) with 409.
 *   - T-06-70: reorder pre-flight asserts every items[].id belongs to :badgeId path.
 */
@Controller('admin-api/v1/admin/quiz-badges/:badgeId/items')
@UseGuards(JwtGuard, RolesGuard)
export class QuizBadgeItemsController {
    constructor(private readonly svc: QuizBadgeItemsService) {}

    @Post()
    @Roles('admin')
    @Audit('quiz_badges.item.create', 'quiz_badge_item')
    public async addItem(
        @Param('badgeId', ParseIntPipe) badgeId: number,
        @Body() dto: UpsertBadgeItemDto,
    ) {
        return this.svc.addItem(badgeId, dto);
    }

    @Patch('reorder')
    @Roles('admin')
    @Audit('quiz_badges.item.reorder', 'quiz_badge_item')
    @HttpCode(HttpStatus.OK)
    public async reorderItems(
        @Param('badgeId', ParseIntPipe) badgeId: number,
        @Body() dto: ReorderBadgeItemsDto,
    ) {
        return this.svc.reorderItems(badgeId, dto);
    }

    @Delete(':itemId')
    @Roles('admin')
    @Audit('quiz_badges.item.delete', 'quiz_badge_item')
    @HttpCode(HttpStatus.OK)
    public async removeItem(
        @Param('badgeId', ParseIntPipe) badgeId: number,
        @Param('itemId', ParseIntPipe) itemId: number,
    ) {
        return this.svc.removeItem(badgeId, itemId);
    }
}
