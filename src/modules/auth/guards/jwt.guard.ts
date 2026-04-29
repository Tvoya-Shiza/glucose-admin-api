import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';

/**
 * JwtGuard — admin-api Bearer-token gate.
 *
 * Extends Passport's AuthGuard('jwt') (which delegates to JwtStrategy in ../jwt/jwt.strategy.ts)
 * and bypasses authentication for handlers/classes annotated with @Public().
 *
 * Wiring (Plan 04): typically applied globally via APP_GUARD so every controller method is
 * authenticated by default; @Public() is the opt-out (e.g. /auth/login).
 */
@Injectable()
export class JwtGuard extends AuthGuard('jwt') {
    constructor(private readonly reflector: Reflector) {
        super();
    }

    canActivate(context: ExecutionContext) {
        const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);
        if (isPublic) return true;
        return super.canActivate(context);
    }
}
