import { plainToInstance } from 'class-transformer';
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
