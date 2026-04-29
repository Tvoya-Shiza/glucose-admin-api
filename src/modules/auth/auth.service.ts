import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { SignOptions } from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';
import type { RoleName } from '@shared/roles';
import { STAFF_ROLES } from '@shared/roles';
import { PrismaService } from '../../prisma/prisma.service';
import { RefreshTokenRepo } from './refresh-token.repo';
import type { AdminJwtPayload, AuthenticatedRequestUser } from './jwt/jwt.strategy';

export interface TokenPair {
    access_token: string;
    access_expires_at: number; // Unix seconds
    refresh_token: string;
    refresh_expires_at: number; // Unix seconds
    refresh_jti: string;
}

export interface LoginResultOk {
    ok: true;
    user_id: number;
    role_name: RoleName;
    email: string | null;
    tokens: TokenPair;
}

export type LoginResult =
    | LoginResultOk
    | { ok: false; reason: 'incorrect' | 'ambiguous' | 'not_staff' | 'inactive' };

@Injectable()
export class AuthService {
    private readonly logger = new Logger(AuthService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly jwtService: JwtService,
        private readonly config: ConfigService,
        private readonly refreshRepo: RefreshTokenRepo,
    ) {}

    public async login(email: string, password: string): Promise<LoginResult> {
        // Defensive findMany — User.email is not yet @unique (HARD-13 blocked).
        const candidates = await this.prisma.user.findMany({
            where: { email, deleted_at: null },
            take: 2,
            select: {
                id: true,
                email: true,
                password: true,
                role_name: true,
                status: true,
            },
        });

        if (candidates.length === 0) {
            return { ok: false, reason: 'incorrect' };
        }
        if (candidates.length > 1) {
            this.logger.warn(`auth.login: ambiguous email=${email} matched ${candidates.length} users`);
            return { ok: false, reason: 'ambiguous' };
        }
        const user = candidates[0];

        // Per CONTEXT.md: only admin/curator/teacher may use admin-api login.
        if (!STAFF_ROLES.includes(user.role_name as RoleName)) {
            return { ok: false, reason: 'not_staff' };
        }

        // Status check — pending/inactive users cannot log in.
        if (user.status !== 'active') {
            return { ok: false, reason: 'inactive' };
        }

        if (!user.password) {
            this.logger.warn(`auth.login: user.id=${user.id} has no password set`);
            return { ok: false, reason: 'incorrect' };
        }

        const passwordOk = await bcrypt.compare(password, user.password);
        if (!passwordOk) {
            return { ok: false, reason: 'incorrect' };
        }

        const role = user.role_name as RoleName;
        const tokens = await this.issueTokenPair(user.id, role, user.email ?? null);

        return {
            ok: true,
            user_id: user.id,
            role_name: role,
            email: user.email ?? null,
            tokens,
        };
    }

    public async refresh(refreshToken: string): Promise<TokenPair> {
        // Validate signature + expiry + alg via JwtService.verifyAsync.
        let payload: AdminJwtPayload;
        try {
            payload = await this.jwtService.verifyAsync<AdminJwtPayload>(refreshToken);
        } catch (err) {
            throw new UnauthorizedException('refresh_invalid');
        }

        if (!payload.jti || !payload.sub || !payload.role_name) {
            throw new UnauthorizedException('refresh_malformed');
        }

        // Confirm jti is in Redis allowlist (defense-in-depth: signed but revoked tokens are rejected).
        const allow = await this.refreshRepo.exists(payload.jti);
        if (!allow || allow.user_id !== payload.sub) {
            throw new UnauthorizedException('refresh_revoked');
        }

        // Re-validate user — role/status may have changed since issuance.
        const user = await this.prisma.user.findUnique({
            where: { id: payload.sub },
            select: { id: true, email: true, role_name: true, status: true, deleted_at: true },
        });
        if (!user || user.deleted_at !== null || user.status !== 'active') {
            // Clean up the stale jti so it can't be re-used.
            await this.refreshRepo.del(payload.jti).catch(() => undefined);
            throw new UnauthorizedException('refresh_user_invalid');
        }
        if (!STAFF_ROLES.includes(user.role_name as RoleName)) {
            await this.refreshRepo.del(payload.jti).catch(() => undefined);
            throw new UnauthorizedException('refresh_not_staff');
        }

        const newJti = randomUUID();
        const refreshTtlSec = this.config.get<number>('jwt.refreshTtlSeconds') ?? 604800;

        // Atomic rotate (AUTH-03): DEL old + SET new in MULTI/EXEC.
        await this.refreshRepo.rotate(payload.jti, newJti, user.id, refreshTtlSec);

        return this.issueTokenPair(user.id, user.role_name as RoleName, user.email ?? null, newJti);
    }

    public async logout(refreshToken: string | null): Promise<void> {
        if (!refreshToken) return;
        try {
            const payload = await this.jwtService.verifyAsync<AdminJwtPayload>(refreshToken, {
                ignoreExpiration: true, // expired tokens still need their jti cleaned up
            });
            if (payload.jti) {
                await this.refreshRepo.del(payload.jti);
            }
        } catch {
            // Idempotent — swallow signature/decoding errors; logout never leaks token validity.
        }
    }

    public async validateUser(userId: number): Promise<AuthenticatedRequestUser | null> {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, email: true, role_name: true, status: true, deleted_at: true },
        });
        if (!user || user.deleted_at !== null || user.status !== 'active') return null;
        if (!STAFF_ROLES.includes(user.role_name as RoleName)) return null;
        return {
            id: user.id,
            role_name: user.role_name as RoleName,
            email: user.email ?? null,
        };
    }

    private async issueTokenPair(
        userId: number,
        roleName: RoleName,
        email: string | null,
        existingJti?: string,
    ): Promise<TokenPair> {
        const accessTtl = this.config.get<string>('jwt.accessTtl') ?? '15m';
        const refreshTtl = this.config.get<string>('jwt.refreshTtl') ?? '7d';
        const refreshTtlSec = this.config.get<number>('jwt.refreshTtlSeconds') ?? 604800;

        const jti = existingJti ?? randomUUID();
        const nowSec = Math.floor(Date.now() / 1000);

        const accessPayload: AdminJwtPayload = {
            sub: userId,
            role_name: roleName,
            email,
        };
        const refreshPayload: AdminJwtPayload = {
            sub: userId,
            role_name: roleName,
            email,
            jti,
        };

        // @nestjs/jwt v11 narrows expiresIn to ms.StringValue; ConfigService returns plain string.
        // Env-validated at boot, so the cast is type-safe in practice (mirrors JwtAdminModule's pattern).
        const access_token = await this.jwtService.signAsync(accessPayload, {
            expiresIn: accessTtl as SignOptions['expiresIn'],
        });
        const refresh_token = await this.jwtService.signAsync(refreshPayload, {
            expiresIn: refreshTtl as SignOptions['expiresIn'],
        });

        // Write jti to allowlist when issuing fresh (login); rotate() already handled the existingJti case.
        if (!existingJti) {
            await this.refreshRepo.set(jti, userId, refreshTtlSec);
        }

        // Compute expires_at — add accessTtl seconds. Parse '15m' → 900.
        const accessTtlSec = parseDurationSec(accessTtl, 900);
        return {
            access_token,
            access_expires_at: nowSec + accessTtlSec,
            refresh_token,
            refresh_expires_at: nowSec + refreshTtlSec,
            refresh_jti: jti,
        };
    }
}

/** Minimal duration parser — accepts '15m' / '7d' / '604800' / '900s'. Returns seconds. */
function parseDurationSec(value: string, fallback: number): number {
    const m = value.match(/^(\d+)\s*(s|m|h|d)?$/);
    if (!m) return fallback;
    const n = parseInt(m[1], 10);
    switch (m[2]) {
        case undefined:
            return n; // bare number = seconds
        case 's':
            return n;
        case 'm':
            return n * 60;
        case 'h':
            return n * 60 * 60;
        case 'd':
            return n * 60 * 60 * 24;
        default:
            return fallback;
    }
}
