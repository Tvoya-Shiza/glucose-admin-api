// smoke import — proves @shared alias resolves at build time.
// Remove this comment + import once a feature module legitimately uses RoleName.
import type { RoleName } from '@shared/roles';
type _UnusedRoleNameSmoke = RoleName;

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuditInterceptor } from './common/audit/audit.interceptor';
import { configuration } from './config/configuration';
import { validateEnv } from './config/env.validation';
import { HealthModule } from './modules/health/health.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            load: [configuration],
            validate: validateEnv,
        }),
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
        PrismaModule,
        HealthModule,
    ],
    controllers: [AppController],
    providers: [
        AppService,
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        // AuditInterceptor runs after ThrottlerGuard so throttled requests are
        // never audited (they're 429 before reaching the handler).
        { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    ],
})
export class AppModule {}
