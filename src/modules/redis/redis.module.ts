import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RedisModule as IoredisModule } from '@nestjs-modules/ioredis';

/**
 * RedisModule (admin-api scope) — registers a single ioredis client globally.
 *
 * Connects from REDIS_HOST/REDIS_PORT/REDIS_PASSWORD via ConfigService.
 * Includes connectTimeout + retryStrategy so a flapping Redis doesn't kill the boot.
 *
 * IMPORTANT — key namespace is enforced at CALL SITES (e.g. RefreshTokenRepo uses
 * 'geonline-admin:refresh:<jti>'). We do NOT set ioredis `keyPrefix` here, because
 * a global prefix is too easy to forget when reading raw keys via redis-cli, and
 * masks bugs where one repo accidentally writes to another's namespace.
 *
 * Distinct from glucose-api's 'geonline:*' keys — admin-api uses 'geonline-admin:*'.
 */
@Global()
@Module({
    imports: [
        IoredisModule.forRootAsync({
            imports: [ConfigModule],
            useFactory: (config: ConfigService) => {
                const host = config.get<string>('redis.host');
                const port = config.get<number>('redis.port');
                const password = config.get<string>('redis.password');
                const auth = password ? `:${encodeURIComponent(password)}@` : '';
                return {
                    type: 'single' as const,
                    url: `redis://${auth}${host}:${port}`,
                    options: {
                        connectTimeout: 10_000,
                        retryStrategy: (times: number) => Math.min(times * 50, 2000),
                    },
                };
            },
            inject: [ConfigService],
        }),
    ],
    exports: [IoredisModule],
})
export class RedisModule {}
