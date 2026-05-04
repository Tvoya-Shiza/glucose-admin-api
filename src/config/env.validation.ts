import { plainToInstance, Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, MinLength, validateSync } from 'class-validator';

class EnvironmentVariables {
    @IsOptional()
    @IsString()
    NODE_ENV?: string;

    @IsOptional()
    @IsNumber()
    PORT?: number;

    @IsString()
    DATABASE_URL!: string;

    // CRITICAL: a strong admin secret is mandatory — no fallback. Min 32 chars.
    @IsString()
    @MinLength(32, { message: 'JWT_ADMIN_SECRET must be at least 32 characters' })
    JWT_ADMIN_SECRET!: string;

    @IsOptional()
    @IsString()
    JWT_ADMIN_ACCESS_TTL?: string;

    @IsOptional()
    @IsString()
    JWT_ADMIN_REFRESH_TTL?: string;

    // Numeric seconds — must match JWT_ADMIN_REFRESH_TTL ('7d' = 604800).
    // Used by RefreshTokenRepo for Redis EX TTL on the jti allowlist key.
    // @Type(() => Number) is belt-and-suspenders alongside enableImplicitConversion in plainToInstance.
    @Type(() => Number)
    @IsNumber()
    JWT_ADMIN_REFRESH_TTL_SECONDS!: number;

    @IsString()
    REDIS_HOST!: string;

    @IsNumber()
    REDIS_PORT!: number;

    @IsOptional()
    @IsString()
    REDIS_PASSWORD?: string;

    // Comma-separated; non-empty required (CORS allowlist NEVER '*' per FND-09)
    @IsString()
    @MinLength(1, { message: 'CORS_ORIGINS must not be empty (no wildcard accepted)' })
    CORS_ORIGINS!: string;

    @IsOptional()
    @IsString()
    GIT_SHA?: string;

    // Phase 5 Plan 04 — file upload (BFF-bypass).
    // Distinct from JWT_ADMIN_SECRET so a leaked admin token can't be replayed
    // as an upload token (T-05-42 confused deputy). Min 32 chars.
    @IsString()
    @MinLength(32, { message: 'JWT_UPLOAD_SECRET must be at least 32 characters' })
    JWT_UPLOAD_SECRET!: string;

    @IsOptional()
    @IsString()
    UPLOAD_BASE_DIR?: string;

    @IsOptional()
    @IsString()
    UPLOAD_PUBLIC_URL_PREFIX?: string;

    // Phase 6 Plan 04 — force-confirm tokens for destructive quiz edits (QZ-06).
    // Distinct from JWT_ADMIN_SECRET / JWT_UPLOAD_SECRET so confused-deputy attempts
    // (presenting an admin Bearer or upload token as a force-confirm token) reject at
    // signature verification (T-06-44). Min 32 chars.
    @IsString()
    @MinLength(32, { message: 'JWT_QUIZ_FORCE_SECRET must be at least 32 characters' })
    JWT_QUIZ_FORCE_SECRET!: string;

    // Phase 8 — Firebase / FCM. All three optional; missing → PushFcmService no-ops.
    @IsOptional()
    @IsString()
    FIREBASE_PROJECT_ID?: string;

    @IsOptional()
    @IsString()
    FIREBASE_CLIENT_EMAIL?: string;

    @IsOptional()
    @IsString()
    FIREBASE_PRIVATE_KEY?: string;

    // Phase 8 — SMTP for admin mailings (PSH-05/06). All optional; missing → MailerService no-ops.
    @IsOptional()
    @IsString()
    SMTP_HOST?: string;

    @IsOptional()
    @IsString()
    SMTP_PORT?: string;

    @IsOptional()
    @IsString()
    SMTP_USER?: string;

    @IsOptional()
    @IsString()
    SMTP_PASSWORD?: string;

    @IsOptional()
    @IsString()
    SMTP_FROM?: string;

    @IsOptional()
    @IsString()
    SMTP_SECURE?: string;
}

export function validateEnv(config: Record<string, unknown>) {
    const validated = plainToInstance(EnvironmentVariables, config, { enableImplicitConversion: true });
    const errors = validateSync(validated, { skipMissingProperties: false });
    if (errors.length > 0) {
        const formatted = errors.map((e) => `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`).join('\n');
        throw new Error(`Invalid environment variables:\n${formatted}`);
    }
    return validated;
}
