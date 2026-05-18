import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';
import { REQUIRE_PERMISSION_KEY, type PermissionRequirement } from '../decorators/require-permission.decorator';
import { PermissionsService } from '../permissions.service';
import type { AuthenticatedRequestUser } from '../../auth/jwt/jwt.strategy';

/**
 * PermissionGuard — runs after JwtGuard + RolesGuard.
 *
 * Posture:
 *   - @Public()                       → bypass.
 *   - No @RequirePermission metadata  → DEFAULT-PASS. RolesGuard has already enforced the
 *                                       role allowlist; permission gating is opt-in per handler.
 *   - role_name === 'admin'           → bypass (super-admin).
 *   - mode === 'all', any code missing → 403 'insufficient_permission'.
 *   - mode === 'any', all codes missing → 403 'insufficient_permission'.
 *
 * PermissionsService never throws — it returns booleans. The guard is the throw site.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
    constructor(
        private readonly reflector: Reflector,
        private readonly permissions: PermissionsService,
    ) {}

    public async canActivate(context: ExecutionContext): Promise<boolean> {
        const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);
        if (isPublic) return true;

        const meta = this.reflector.getAllAndOverride<PermissionRequirement | undefined>(
            REQUIRE_PERMISSION_KEY,
            [context.getHandler(), context.getClass()],
        );
        if (!meta || meta.codes.length === 0) return true;

        const req = context.switchToHttp().getRequest();
        const user = req?.user as AuthenticatedRequestUser | undefined;
        if (!user) {
            throw new ForbiddenException('unauthenticated');
        }
        if (user.role_name === 'admin') return true;

        const actor = { id: user.id, role_name: user.role_name, role_id: user.role_id };
        const ok =
            meta.mode === 'all'
                ? await this.permissions.canAll(actor, meta.codes)
                : await this.permissions.canAny(actor, meta.codes);

        if (!ok) {
            throw new ForbiddenException('insufficient_permission');
        }
        return true;
    }
}
