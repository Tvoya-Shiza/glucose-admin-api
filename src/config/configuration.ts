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
    throttler: {
        ttl: 60_000,
        limit: 100,
    },
});

export type AppConfiguration = ReturnType<typeof configuration>;
