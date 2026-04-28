import { SetMetadata } from '@nestjs/common';
import type { AuditMeta, SkipAuditMeta } from './audit.types';

/**
 * Metadata keys consumed by `AuditInterceptor` via `Reflector.get(...)`.
 *
 * AUTH-12: every non-GET admin mutation MUST carry either `@Audit(...)` or
 * `@SkipAudit(reason)`. The `ci:audit-required` lint enforces this at CI time —
 * decoration is not enforced at runtime (TypeScript strings can't be validated
 * at decorator application time).
 */
export const AUDIT_METADATA_KEY = 'audit:meta';
export const SKIP_AUDIT_METADATA_KEY = 'audit:skip';

/**
 * Mark a mutation handler for audit logging.
 *
 * @param action  Verb-form action key, e.g. `'user.update'`, `'auth.logout'`.
 * @param entity  Resource type, e.g. `'user'`, `'session'`.
 *
 * Example:
 *   @Post()
 *   @Audit('user.update', 'user')
 *   async update(@Body() dto: UpdateUserDto) { ... }
 */
export const Audit = (action: string, entity: string) =>
    SetMetadata(AUDIT_METADATA_KEY, { action, entity } satisfies AuditMeta);

/**
 * Explicitly opt out of audit logging for a non-GET handler. The reason is
 * documented in code and reviewed at PR time. The `ci:audit-required` lint
 * rejects empty-string reasons.
 *
 * Example:
 *   @Post('idempotent-toggle')
 *   @SkipAudit('side-effect free toggle, no state change to audit')
 *   async toggle() { ... }
 */
export const SkipAudit = (reason: string) =>
    SetMetadata(SKIP_AUDIT_METADATA_KEY, { reason } satisfies SkipAuditMeta);
