import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { RoleName } from '@shared/roles';

export interface AdminJwtPayload {
    sub: number;
    role_name: RoleName;
    email: string | null;
    jti?: string; // present on refresh tokens, absent on access tokens
    iat?: number;
    exp?: number;
}

export interface AuthenticatedRequestUser {
    id: number;
    role_name: RoleName;
    email: string | null;
}

/**
 * Admin-api JWT strategy — Bearer header only.
 *
 * The BFF proxy at glucose-admin-client/src/app/api/proxy/[...path]/route.ts
 * attaches the access token from the httpOnly cookie as a Bearer header server-to-server.
 * Browsers never send Bearer tokens to admin-api — same-origin same-host only.
 *
 * The /auth/refresh endpoint reads the refresh token from the request BODY (not via this strategy);
 * see Plan 04 for the body-field extraction.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    constructor(config: ConfigService) {
        const secret = config.get<string>('jwt.adminSecret');
        if (!secret || secret.length < 32) {
            throw new Error('JWT_ADMIN_SECRET is not configured — refusing to start');
        }
        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            ignoreExpiration: false,
            secretOrKey: secret,
            algorithms: ['HS256'],
        });
    }

    async validate(payload: AdminJwtPayload): Promise<AuthenticatedRequestUser> {
        if (!payload?.sub || !payload?.role_name) {
            throw new UnauthorizedException('invalid_token_payload');
        }
        // Reject if a refresh token is presented at a Bearer-protected route.
        // Refresh tokens carry `jti`; access tokens do not.
        if (payload.jti) {
            throw new UnauthorizedException('refresh_token_misused');
        }
        return {
            id: payload.sub,
            role_name: payload.role_name,
            email: payload.email ?? null,
        };
    }
}
