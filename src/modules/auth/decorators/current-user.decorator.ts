import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequestUser } from '../jwt/jwt.strategy';

/**
 * @CurrentUser() — param decorator returning the authenticated request user.
 *
 * Populated by JwtStrategy.validate (see ../jwt/jwt.strategy.ts). Only safe to use on
 * handlers behind JwtGuard — on @Public() handlers req.user is undefined and the
 * returned value will be `undefined`.
 *
 * Usage:
 *   handler(@CurrentUser() actor: AuthenticatedRequestUser) { ... }
 */
export const CurrentUser = createParamDecorator(
    (_: unknown, ctx: ExecutionContext): AuthenticatedRequestUser => {
        return ctx.switchToHttp().getRequest().user;
    },
);
