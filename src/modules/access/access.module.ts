import { Module } from '@nestjs/common';
import { AccessController } from './access.controller';
import { AccessService } from './access.service';
import { PermissionsCache } from './permissions.cache';
import { PermissionsService } from './permissions.service';

/**
 * AccessModule — RBAC core.
 *
 * Provides:
 *   - PermissionsService  (central `can()` checker; exported so PermissionGuard + AuthController can inject it)
 *   - PermissionsCache    (Redis-backed role → codes cache)
 *   - AccessService       (CRUD over roles + role_permissions; exposed via AccessController)
 *
 * Exports:
 *   - PermissionsService (used by PermissionGuard in app.module APP_GUARD wiring and by AuthController for /me).
 */
@Module({
    controllers: [AccessController],
    providers: [PermissionsService, PermissionsCache, AccessService],
    exports: [PermissionsService],
})
export class AccessModule {}
