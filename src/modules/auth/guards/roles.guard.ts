import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { RoleName } from '@shared/roles';
import { ROLES_METADATA_KEY } from '../decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';

/**
 * RolesGuard — default-deny RBAC gate.
 *
 * Reads @Roles(...) metadata via Reflector.getAllAndOverride (method overrides class).
 * Bypasses entirely on @Public()-annotated handlers/classes.
 *
 * Default-deny posture (per AUTH-05 / T-02-11):
 *   - No @Roles() AND no @Public() → ForbiddenException('roles_not_declared').
 *     Every authenticated method MUST explicitly declare its allowlist.
 *   - req.user.role_name not in the allowlist → ForbiddenException('insufficient_role').
 *
 * Wiring (Plan 04): typically applied globally via APP_GUARD AFTER JwtGuard so req.user
 * is populated by JwtStrategy.validate before this guard runs.
 */
@Injectable()
export class RolesGuard implements CanActivate {
    constructor(private readonly reflector: Reflector) {}

    canActivate(context: ExecutionContext): boolean {
        const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);
        if (isPublic) return true;

        const required = this.reflector.getAllAndOverride<RoleName[] | undefined>(ROLES_METADATA_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);

        // No @Roles() declared → access is denied by default. Per AUTH-05, every method must explicitly
        // declare its allowlist. The @Public() escape hatch is for /auth/login only.
        if (!required || required.length === 0) {
            throw new ForbiddenException('roles_not_declared');
        }

        const req = context.switchToHttp().getRequest();
        const role: RoleName | undefined = req?.user?.role_name;

        if (!role || !required.includes(role)) {
            throw new ForbiddenException('insufficient_role');
        }
        return true;
    }
}
