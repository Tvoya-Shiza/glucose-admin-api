import * as winston from 'winston';

/**
 * Free-standing Winston logger that writes one NDJSON line per audit entry to
 * `logs/admin-audit.log`. Mirrors the `promocodeLogger` pattern from
 * glucose-api/src/config/logger.config.ts — a separate `winston.createLogger`
 * outside the main `winstonConfig` so its transport never bleeds into the
 * application's combined.log / error.log files.
 *
 * NDJSON contract: each call site does `auditLogger.info(JSON.stringify(entry))`.
 * The printf format below passes the message through unchanged so each line
 * in the file is exactly one valid JSON object — replayable by a follow-up
 * script (Pass B) into the eventual `AdminAuditLog` table.
 *
 * Rotation: 5 MB × 10 files = ~50 MB ceiling per host (T-02-04 mitigation).
 */
const auditFormat = winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ message }) => message as string)
);

export const auditLogger = winston.createLogger({
    level: 'info',
    transports: [
        new winston.transports.File({
            filename: 'admin-audit.log',
            dirname: 'logs',
            maxsize: 5 * 1024 * 1024,
            maxFiles: 10,
            format: auditFormat,
        }),
    ],
});
