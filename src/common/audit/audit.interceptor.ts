import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { PrismaService } from '../../prisma/prisma.service';
import { AUDIT_METADATA_KEY, SKIP_AUDIT_METADATA_KEY } from './audit.decorator';
import { auditLogger } from './audit.logger';
import type { AuditEntry, AuditMeta, SkipAuditMeta } from './audit.types';

/**
 * Global interceptor that materializes audit entries for every controller
 * method decorated with `@Audit(action, entity)` (and skips those decorated
 * with `@SkipAudit(reason)`). Wired in `app.module.ts` via `APP_INTERCEPTOR`.
 *
 * Failure mode: best-effort. The interceptor NEVER blocks the mutation
 * response; if the Winston file write throws, the error is logged and the
 * request still completes. Audit logging is observability, not authorization.
 *
 * Phase 2 emits the locked core fields only. `before`/`after` snapshots are
 * deferred to Phase 3+ via an opt-in `@AuditCapture()` companion decorator.
 *
 * actor_id is read from `req.user.id`. Until Plan 03 wires JwtGuard the field
 * will be `null` — by integration time (Plan 04 onwards) every @Audit-decorated
 * route is behind the guard, so a non-null actor_id is the steady state.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
    private readonly logger = new Logger(AuditInterceptor.name);

    constructor(
        private readonly reflector: Reflector,
        private readonly prisma: PrismaService
    ) {}

    /**
     * Best-effort DB persist of an audit entry. Writes via Prisma to the
     * `admin_audit_logs` table when it exists; silently falls through to the
     * NDJSON file when the table is missing (Phase 1 Plan 08 schema additions
     * have been written but `prisma migrate dev` has NOT yet run against live
     * MySQL — the table will not exist until the human operator applies the
     * migration). The NDJSON file is the source-of-truth until that happens
     * and remains an authoritative replay source even after.
     *
     * Failure modes (table missing, DB unreachable, schema drift) MUST NOT
     * propagate — auditing is observability, not authorization. Errors are
     * logged at debug level so noisy 'table missing' messages don't fill the
     * combined log during the deferral window.
     */
    private async persistToDb(entry: AuditEntry): Promise<void> {
        try {
            // Cast to any: the generated Prisma client may not yet have
            // adminAuditLog (it does after schema regeneration in Plan 08, but
            // belt-and-braces — the moment the model exists, this resolves to
            // the typed delegate; until then the assertion keeps tsc happy).
            const delegate: any = (this.prisma as any).adminAuditLog;
            if (!delegate || typeof delegate.create !== 'function') {
                return;
            }
            await delegate.create({
                data: {
                    ts: entry.ts,
                    actor_id: entry.actor_id,
                    action: entry.action,
                    entity: entry.entity,
                    entity_id: entry.entity_id,
                    ip: entry.ip,
                    ua: entry.ua,
                    before: entry.before === undefined ? null : (entry.before as any),
                    after: entry.after === undefined ? null : (entry.after as any),
                    meta: entry.meta === undefined ? null : (entry.meta as any),
                    bulk_op_id: (entry.meta?.bulk_op_id as string | undefined) ?? null,
                    request_id: (entry.meta?.request_id as string | undefined) ?? null,
                },
            });
        } catch (err) {
            // Table likely missing (migration not yet applied) OR DB unreachable.
            // NDJSON write below remains the authoritative record.
            this.logger.debug(`audit DB write skipped: ${(err as Error)?.message}`);
        }
    }

    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        const handler = context.getHandler();
        const auditMeta = this.reflector.get<AuditMeta>(AUDIT_METADATA_KEY, handler);
        const skipMeta = this.reflector.get<SkipAuditMeta>(SKIP_AUDIT_METADATA_KEY, handler);

        // No @Audit, or explicit @SkipAudit -> not audited. Missing-decorator on
        // a non-GET handler is caught at CI time by ci-audit-decorator-check.cjs.
        if (!auditMeta || skipMeta) {
            return next.handle();
        }

        const req = context.switchToHttp().getRequest();
        const startTs = Math.floor(Date.now() / 1000);
        const actor_id = (req?.user?.id as number | undefined) ?? null;
        const ip = extractIp(req);
        const ua = (req?.headers?.['user-agent'] as string | undefined) ?? null;
        const route_id = (req?.params?.id as string | undefined) ?? null;

        return next.handle().pipe(
            tap((response) => {
                try {
                    const entity_id = resolveEntityId(response, route_id);
                    const entry: AuditEntry = {
                        ts: startTs,
                        actor_id,
                        action: auditMeta.action,
                        entity: auditMeta.entity,
                        entity_id,
                        ip,
                        ua,
                    };
                    // NDJSON write is the source of truth until the migration runs.
                    auditLogger.info(JSON.stringify(entry));
                    // Best-effort DB persist; silently no-ops while admin_audit_logs
                    // table is missing (Plan 08 migration deferred).
                    void this.persistToDb(entry);
                } catch (err) {
                    // Best-effort: never block the response. Surface via Winston error.
                    auditLogger.error(`audit-write-failed: ${(err as Error).message}`);
                }
            }),
            catchError((err) => {
                // Mutation threw -- record the attempt with meta.failed = true so
                // the audit trail still captures failed admin actions (repudiation
                // resistance per T-02-01). Never swallow the original error.
                try {
                    const entry: AuditEntry = {
                        ts: startTs,
                        actor_id,
                        action: auditMeta.action,
                        entity: auditMeta.entity,
                        entity_id: route_id,
                        ip,
                        ua,
                        meta: { failed: true, error_name: (err as Error).name },
                    };
                    auditLogger.info(JSON.stringify(entry));
                    void this.persistToDb(entry);
                } catch (logErr) {
                    auditLogger.error(`audit-write-failed: ${(logErr as Error).message}`);
                }
                return throwError(() => err);
            })
        );
    }
}

function extractIp(req: any): string | null {
    const fwd = req?.headers?.['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd.length > 0) {
        return fwd.split(',')[0]?.trim() ?? null;
    }
    return (req?.ip as string | undefined) ?? null;
}

function resolveEntityId(response: any, fallback: string | null): string | null {
    if (response && typeof response === 'object') {
        // Try res.id first, then res.data.id (apiResponse() wraps payload as `data`).
        if (response.id !== undefined && response.id !== null) {
            return String(response.id);
        }
        if (response.data && typeof response.data === 'object' && response.data.id !== undefined && response.data.id !== null) {
            return String(response.data.id);
        }
    }
    return fallback;
}
