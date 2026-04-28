/**
 * Audit log entry shape — locked contract that mirrors the eventual `AdminAuditLog`
 * Prisma row (Phase 1 Plan 08 / SCH-01, currently blocked by DATABASE_URL).
 *
 * Phase 2 emits these as NDJSON lines into `logs/admin-audit.log` so a future
 * replay script can do a straight insert into `AdminAuditLog` without reshaping.
 *
 * Field semantics:
 * - `ts`           Unix seconds (`Math.floor(Date.now() / 1000)`) — matches glucose-api timestamp pattern.
 * - `actor_id`     `req.user.id` populated by JwtGuard. `null` only if @SkipAudit or anonymous (anomalous on a mutation).
 * - `action`       Decorator first arg, e.g. `'user.update'`, `'auth.logout'`.
 * - `entity`       Decorator second arg, e.g. `'user'`, `'session'`.
 * - `entity_id`    Resolved from response body (`res.id` / `res.data.id`) or route param `:id`.
 * - `ip`           First hop of `X-Forwarded-For`, falling back to `req.ip`.
 * - `ua`           `User-Agent` header.
 * - `before`/`after` snapshots — off by default; Phase 3+ may opt in via `@AuditCapture()`.
 * - `meta`         Free-form, e.g. `{ failed: true, error_name: 'ForbiddenException' }`.
 */
export interface AuditEntry {
    ts: number;
    actor_id: number | null;
    action: string;
    entity: string;
    entity_id: string | null;
    ip: string | null;
    ua: string | null;
    before?: unknown;
    after?: unknown;
    meta?: Record<string, unknown>;
}

export interface AuditMeta {
    action: string;
    entity: string;
}

export interface SkipAuditMeta {
    reason: string;
}
