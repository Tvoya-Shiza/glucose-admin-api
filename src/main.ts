import { ValidationPipe, ValidationPipeOptions } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { WinstonModule } from 'nest-winston';
import { AppModule } from './app.module';
import { winstonConfig } from './config/logger.config';
import { BigIntStringInterceptor } from './common/interceptors/bigint-string.interceptor';

const validationPipeOptions: ValidationPipeOptions = {
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
};

async function bootstrap() {
    const app = await NestFactory.create(AppModule, {
        logger: WinstonModule.createLogger(winstonConfig),
    });

    app.useGlobalPipes(new ValidationPipe(validationPipeOptions));
    app.useGlobalInterceptors(new BigIntStringInterceptor());

    // Cookie parsing — required for /admin-api/auth/logout's refresh-cookie fallback (Phase 2 Plan 04).
    // Registered before helmet so subsequent middleware can read req.cookies.
    app.use(cookieParser());

    // Security baseline — FND-09
    app.use(helmet());

    const config = app.get(ConfigService);
    const corsOrigins = config.get<string[]>('cors.origins') ?? [];

    // CORS allowlist — NEVER '*'. Empty list rejects every origin (env validation also rejects empty CORS_ORIGINS at boot).
    app.enableCors({
        origin: corsOrigins,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
        credentials: true, // BFF cookie pattern in Phase 2 needs this
    });

    const port = config.get<number>('app.port') ?? 4101;
    await app.listen(port);
}

// INTENTIONALLY DOES NOT patch BigInt.prototype.toJSON.
// Admin-api always emits BigInt as string via the BigIntStringInterceptor.

bootstrap().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
});
