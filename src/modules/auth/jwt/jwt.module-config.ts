import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, type JwtModuleOptions } from '@nestjs/jwt';
import type { SignOptions } from 'jsonwebtoken';

/**
 * JwtAdminModule — re-exports JwtModule registered with admin-api's dedicated secret.
 * Auth feature module imports this; the strategy reads the same secret.
 *
 * Per AUTH-04: JWT_ADMIN_SECRET is separate from glucose-api's JWT_SECRET; no fallback.
 * Per CONTEXT.md: HS256, kid: 'admin-v1', expiresIn: '15m' for access tokens.
 * Refresh tokens are signed with the same secret + same kid but with expiresIn from refreshTtl.
 */
@Module({
    imports: [
        JwtModule.registerAsync({
            imports: [ConfigModule],
            useFactory: (config: ConfigService): JwtModuleOptions => {
                const secret = config.get<string>('jwt.adminSecret');
                if (!secret || secret.length < 32) {
                    throw new Error(
                        'JWT_ADMIN_SECRET is not configured (or shorter than 32 chars) — refusing to start with insecure default'
                    );
                }
                // @nestjs/jwt v11 typechecks expiresIn against ms.StringValue.
                // ConfigService returns plain `string`; cast here to keep the contract
                // ergonomic for env-driven values like '15m' / '7d' validated by env.validation.ts.
                const expiresIn = (config.get<string>('jwt.accessTtl') ?? '15m') as SignOptions['expiresIn'];
                return {
                    secret,
                    signOptions: {
                        algorithm: 'HS256',
                        keyid: 'admin-v1',
                        expiresIn,
                        // Refresh tokens override `expiresIn` at sign() time using jwt.refreshTtl.
                    },
                };
            },
            inject: [ConfigService],
        }),
    ],
    exports: [JwtModule],
})
export class JwtAdminModule {}
