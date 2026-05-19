import { Global, Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { AdminNotificationsService } from './admin-notifications.service';
import { NotificationsController } from './notifications.controller';

/**
 * @Global so feature modules (boards, future ones) can inject
 * `AdminNotificationsService` without re-importing this module.
 */
@Global()
@Module({
    imports: [AccessModule],
    controllers: [NotificationsController],
    providers: [AdminNotificationsService],
    exports: [AdminNotificationsService],
})
export class NotificationsModule {}
