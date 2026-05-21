import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { ProgressOverridesController } from './progress-overrides.controller';
import { ProgressOverridesService } from './progress-overrides.service';

/**
 * Phase 19 / Feature B1 — Progress overrides module.
 *
 * Mounted at /admin-api/v1/admin/courses/:courseId/overrides.
 * AccessModule supplies PermissionsService for @RequirePermission gates.
 */
@Module({
    imports: [AccessModule],
    controllers: [ProgressOverridesController],
    providers: [ProgressOverridesService],
    exports: [ProgressOverridesService],
})
export class ProgressOverridesModule {}
