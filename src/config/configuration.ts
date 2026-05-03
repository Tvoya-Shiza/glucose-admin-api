export const configuration = () => ({
    app: {
        port: parseInt(process.env.PORT ?? '4101', 10),
        nodeEnv: process.env.NODE_ENV ?? 'development',
        gitSha: process.env.GIT_SHA ?? 'dev',
    },
    database: {
        url: process.env.DATABASE_URL ?? '',
    },
    jwt: {
        adminSecret: process.env.JWT_ADMIN_SECRET ?? '',
        accessTtl: process.env.JWT_ADMIN_ACCESS_TTL ?? '15m',
        refreshTtl: process.env.JWT_ADMIN_REFRESH_TTL ?? '7d',
        // Numeric seconds parallel to refreshTtl ('7d' string). ioredis SET EX requires a number.
        // env.validation.ts rejects boot when this is missing/non-numeric; the default below is a safety net.
        refreshTtlSeconds: parseInt(process.env.JWT_ADMIN_REFRESH_TTL_SECONDS ?? '604800', 10),
    },
    redis: {
        host: process.env.REDIS_HOST ?? '',
        port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
        password: process.env.REDIS_PASSWORD ?? '',
    },
    cors: {
        origins: (process.env.CORS_ORIGINS ?? '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
    },
    upload: {
        // Phase 5 Plan 04 (CRS-05) — file upload BFF bypass.
        // Distinct secret from JWT_ADMIN_SECRET so a leaked admin token
        // can't be replayed as an upload token (T-05-42 confused deputy).
        secret: process.env.JWT_UPLOAD_SECRET ?? '',
        baseDir: process.env.UPLOAD_BASE_DIR ?? '/var/data/glucose-uploads/courses',
        publicUrlPrefix: process.env.UPLOAD_PUBLIC_URL_PREFIX ?? '/static/courses',
    },
    quizForce: {
        // Phase 6 Plan 04 (QZ-06) — force-confirm tokens for destructive quiz edits.
        // Distinct secret from JWT_ADMIN_SECRET / JWT_UPLOAD_SECRET so confused-deputy
        // attempts (presenting an admin Bearer or upload token as a force-confirm
        // token) reject at signature verify (T-06-44).
        secret: process.env.JWT_QUIZ_FORCE_SECRET ?? '',
    },
    throttler: {
        ttl: 60_000,
        limit: 100,
    },
});

export type AppConfiguration = ReturnType<typeof configuration>;
