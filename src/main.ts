import { Logger, ValidationPipe, ValidationPipeOptions } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { WinstonModule } from 'nest-winston';
import * as path from 'path';
import { AppModule } from './app.module';
import { winstonConfig } from './config/logger.config';
import { BigIntStringInterceptor } from './common/interceptors/bigint-string.interceptor';

const validationPipeOptions: ValidationPipeOptions = {
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
};

async function bootstrap() {
    const app = await NestFactory.create<NestExpressApplication>(AppModule, {
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
    // X-Upload-Token is required for the BFF-bypass upload route (CONTEXT D-13) — browser sends it directly to admin-api.
    app.enableCors({
        origin: corsOrigins,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Upload-Token'],
        credentials: true, // BFF cookie pattern in Phase 2 needs this
    });

    // Static serving for uploaded files — gated behind UPLOAD_SERVE_STATIC.
    // Prod: false; nginx serves UPLOAD_BASE_DIR at UPLOAD_PUBLIC_URL_PREFIX directly.
    // Dev/standalone: true; Nest serves /static/courses so browser previews work without nginx.
    //
    // setHeaders overrides helmet's default Cross-Origin-Resource-Policy: same-origin
    // for THIS path only. Without this, admin-client (different origin) gets the file
    // body but the browser refuses to render <img> / <video> from it.
    if (config.get<boolean>('upload.serveStatic')) {
        const baseDir = config.get<string>('upload.baseDir')!;
        const prefix = config.get<string>('upload.publicUrlPrefix')!;
        const resolved = path.resolve(baseDir);
        app.useStaticAssets(resolved, {
            prefix,
            setHeaders: (res) => {
                res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
            },
        });
        new Logger('Bootstrap').log(`Static serving ${prefix} from ${resolved}`);
    }

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
