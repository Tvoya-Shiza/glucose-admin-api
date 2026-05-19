import { BadRequestException, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { Audit } from '../../common/audit/audit.decorator';
import { PermissionGuard } from '../access/guards/permission.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtGuard } from '../auth/guards/jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { AdminNotificationsService } from './admin-notifications.service';
import { ListNotificationsDto } from './dto/list-notifications.dto';

/**
 * In-app notification feed for the current actor.
 *
 * RBAC: every staff role (admin / curator / teacher / custom) needs in-app
 * notifications — there is no separate `notifications.view` permission. The
 * @Roles list intentionally includes all three core roles; custom roles can
 * read their own notifications too (the WHERE clause filters by `user_id`).
 */
@Controller('admin-api/v1/admin/notifications')
@UseGuards(JwtGuard, RolesGuard, PermissionGuard)
export class NotificationsController {
    constructor(private readonly service: AdminNotificationsService) {}

    @Get()
    @Roles('admin', 'curator', 'teacher')
    public async list(@CurrentUser() actor: AuthenticatedRequestUser, @Query() query: ListNotificationsDto) {
        return this.service.list(actor.id, query);
    }

    @Get('unread-count')
    @Roles('admin', 'curator', 'teacher')
    public async unreadCount(@CurrentUser() actor: AuthenticatedRequestUser) {
        return this.service.unreadCount(actor.id);
    }

    @Patch(':id/read')
    @Roles('admin', 'curator', 'teacher')
    @Audit('notification.read', 'admin_notification')
    public async markRead(@CurrentUser() actor: AuthenticatedRequestUser, @Param('id') id: string) {
        if (!/^[1-9]\d{0,18}$/.test(id)) throw new BadRequestException('invalid_notification_id');
        return this.service.markRead(actor.id, BigInt(id));
    }

    @Patch('read-all')
    @Roles('admin', 'curator', 'teacher')
    @Audit('notification.read_all', 'admin_notification')
    public async markAllRead(@CurrentUser() actor: AuthenticatedRequestUser) {
        return this.service.markAllRead(actor.id);
    }
}
