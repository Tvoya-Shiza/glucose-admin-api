// Admin-api Winston config mirrors glucose-api/src/config/logger.config.ts.
// Phase 2 may add an admin-audit.log transport when AdminAuditLog interceptor lands.
import * as winston from 'winston';

const timeFormat = 'YYYY-MM-DD HH:mm:ss';

const consoleFormat = winston.format.combine(
    winston.format.timestamp({ format: timeFormat }),
    winston.format.colorize({ all: true }),
    winston.format.printf(({ timestamp, level, context, message, stack, ...meta }) => {
        const ctx = context ? `[${context}]` : '[App]';
        const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
        return `${timestamp} ${level.toUpperCase().padEnd(7)} ${ctx.padEnd(15)} ${message}${stack ? '\n' + stack : ''}${metaStr}`;
    })
);

const fileFormat = winston.format.combine(
    winston.format.timestamp({ format: timeFormat }),
    winston.format.printf(({ timestamp, level, context, message, stack, ...meta }) => {
        const ctx = context ? `[${context}]` : '[App]';
        const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
        return `${timestamp} ${level.toUpperCase().padEnd(7)} ${ctx.padEnd(15)} ${message}${stack ? '\n' + stack : ''}${metaStr}`;
    })
);

export const winstonConfig = {
    transports: [
        new winston.transports.Console({
            format: consoleFormat,
        }),
        new winston.transports.File({
            filename: 'error.log',
            level: 'error',
            maxsize: 2097152,
            maxFiles: 10,
            dirname: 'logs',
            format: fileFormat,
        }),
        new winston.transports.File({
            filename: 'combined.log',
            level: 'info',
            maxsize: 2097152,
            maxFiles: 10,
            dirname: 'logs',
            format: fileFormat,
        }),
    ],
};
