import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RoleName } from '@shared/roles';
import type { AuthenticatedRequestUser } from '../auth/jwt/jwt.strategy';
import { verifyUploadToken } from './upload-token.signer';

/**
 * UploadTokenGuard — verifies the X-Upload-Token header for the BFF-bypass file
 * upload endpoint (POST /admin-api/v1/admin/uploads/file).
 *
 * Why a dedicated guard (not JwtGuard / RolesGuard):
 *   - The browser hits this route DIRECTLY (per CONTEXT D-13). The admin Bearer
 *     cookie is intentionally NOT trusted here — the upload token IS the credential.
 *   - Verifying the token in a guard (instead of inline in the controller) lets us
 *     populate `req.user` BEFORE the handler runs, which is what the global
 *     AuditInterceptor reads to attribute the audit row's actor_id.
 *
 * What this guard does NOT do:
 *   - Single-use jti enforcement (Redis SET NX). That lives in UploadsService so
 *     the audit row records the failed-replay attempt against the same actor;
 *     the guard pass merely means "token is well-signed and unexpired".
 *   - File-vs-claims validation (size/MIME). That also lives in the service.
 *
 * Threat coverage: T-05-30 (forgery — signature check rejects), T-05-42 (confused
 * deputy — JWT_UPLOAD_SECRET differs from JWT_ADMIN_SECRET).
 */
@Injectable()
export class UploadTokenGuard implements CanActivate {
    private readonly logger = new Logger(UploadTokenGuard.name);
    private readonly secret: string;

    constructor(config: ConfigService) {
        const s = config.get<string>('upload.secret') ?? process.env.JWT_UPLOAD_SECRET;
        if (!s || s.length < 32) {
            throw new Error('JWT_UPLOAD_SECRET is not configured (or shorter than 32 chars) — refusing to start');
        }
        this.secret = s;
    }

    canActivate(context: ExecutionContext): boolean {
        const req = context.switchToHttp().getRequest();
        const headerValue = req?.headers?.['x-upload-token'];
        const token: string | undefined = Array.isArray(headerValue) ? headerValue[0] : headerValue;
        if (!token || typeof token !== 'string' || token.length === 0) {
            throw new UnauthorizedException('upload.token_missing');
        }
        try {
            const claims = verifyUploadToken(token, this.secret);
            // Populate req.user so AuditInterceptor.actor_id resolves correctly.
            // Mirror the AuthenticatedRequestUser shape that JwtStrategy.validate produces.
            const user: AuthenticatedRequestUser = {
                id: claims.sub,
                role_name: claims.role as RoleName,
                email: null,
            };
            req.user = user;
            // Stash the verified token for the controller (avoids re-verifying).
            req.uploadToken = token;
            return true;
        } catch (err) {
            this.logger.debug(`upload token guard reject: ${(err as Error).message}`);
            throw new UnauthorizedException('upload.token_invalid');
        }
    }
}
