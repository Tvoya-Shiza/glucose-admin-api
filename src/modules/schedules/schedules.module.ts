import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { SchedulesGridController } from './schedules-grid.controller';
import { SchedulesListController } from './schedules-list.controller';
import { SchedulesListService } from './schedules-list.service';
import { SchedulesMutationsController } from './schedules-mutations.controller';
import { SchedulesMutationsService } from './schedules-mutations.service';

/**
 * SchedulesModule — lesson schedule calendar admin surface.
 *
 * Two read endpoints (list + calendar) share the same service so calendar
 * intersection logic and list pagination evolve together. Static routes
 * `/calendar` and `/analytics` precede `:id` in the controller — Nest matches
 * static segments first only if they're declared before the param route.
 */
@Module({
    imports: [AccessModule],
    controllers: [SchedulesListController, SchedulesMutationsController, SchedulesGridController],
    providers: [SchedulesListService, SchedulesMutationsService],
    exports: [],
})
export class SchedulesModule {}
