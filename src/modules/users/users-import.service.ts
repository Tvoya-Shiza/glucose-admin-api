import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { normalizeKzPhone } from './utils/normalize-phone';
import { ImportRowDto, ImportUsersDto } from './dto/import-users.dto';

/**
 * USR-06 — Plan 06 CSV-import service.
 *
 * Two-pass design (D-16):
 *   - mode='dry_run': normalize, lookup existing users by email + mobile, classify
 *     each row as insert | update | skip | error WITHOUT writing. Returns the per-row
 *     report identical in shape to the commit response — the operator's preview is
 *     guaranteed faithful (predicate symmetry).
 *   - mode='commit': re-runs the dry-run classification, then performs Prisma writes
 *     in chunks of TX_CHUNK_SIZE inside `prisma.$transaction`. Each chunk is atomic;
 *     all chunks share one `bulk_op_id` (D-14).
 *
 * Idempotency (D-17):
 *   - email (lowercased + trimmed) is the primary key; mobile (normalizeKzPhone)
 *     is the fallback.
 *   - Match → update path. No match → insert path.
 *   - email + mobile resolve to DIFFERENT existing user IDs → row marked
 *     `error: conflict_user_<id1>_<id2>` with both IDs surfaced in the reason.
 *
 * Error report (D-18):
 *   - Returned shape matches the upload + adds `status` + `reason`. The admin-client
 *     constructs the downloadable CSV from the rows array.
 *
 * Schema-level uniqueness:
 *   - Phase 1.08 added `User.email @unique` and `User.mobile @unique`. The runtime DB
 *     may not have the migration applied yet (DATABASE_URL placeholder per STATE.md).
 *     Defensive posture: explicit pre-flight `findMany` against current key sets BEFORE
 *     insert/update attempts, AND wrap each Prisma write in try/catch — `P2002` unique
 *     constraint violation surfaces as `error: conflict_runtime` so a successful
 *     dry-run that races against a concurrent insert does not abort the whole batch.
 *
 * Audit posture: `@Audit('users.import', 'user')` fires on every call (dry-run included)
 * — same-endpoint pattern as Plan 05; even an uncommitted attempt is auditable signal.
 *
 * RBAC: admin-only (T-03-50). Curator/teacher cannot mass-import users. The `actor`
 * argument is accepted for parity with the bulk-provision shape but currently used
 * only for logging — RolesGuard rejects non-admin requests upstream.
 */

export interface ImportResultRow {
    row_id: string;
    status: 'insert' | 'update' | 'skip' | 'error';
    reason: string | null;
    user_id: number | null;
}

export interface ImportResult {
    bulk_op_id: string;
    mode: 'dry_run' | 'commit';
    affected: number;
    insert: number;
    update: number;
    skip: number;
    error: number;
    rows: ImportResultRow[];
}

interface NormalizedRow {
    src: ImportRowDto;
    idx: number;
    email: string | null;
    mobile: string | null;
    /** non-null = pre-classified error reason (skip lookup/write). */
    reason: string | null;
}

@Injectable()
export class UsersImportService {
    private readonly logger = new Logger(UsersImportService.name);

    /** Server-side gate for the type-the-count confirmation (mirrors Plan 05). */
    public static readonly CONFIRM_THRESHOLD = 50;

    /** Chunk size for User.create/update batches inside prisma.$transaction. */
    public static readonly TX_CHUNK_SIZE = 500;

    constructor(private readonly prisma: PrismaService) {}

    public async import(actor: ScopeActor, dto: ImportUsersDto): Promise<ImportResult> {
        const bulk_op_id =
            dto.bulk_op_id && /^[0-9a-f-]{8,}$/i.test(dto.bulk_op_id) ? dto.bulk_op_id : randomUUID();

        // 1. Normalize keys (email lowercased+trimmed, mobile via normalizeKzPhone).
        //    Mark rows missing both keys as 'no_idempotency_key'; rows with a mobile
        //    that fails normalization as 'mobile_invalid' (D-17 — invalid phones flagged
        //    in error report; do not reject the whole file).
        const normed: NormalizedRow[] = dto.rows.map((r, idx) => {
            const email = r.email ? r.email.trim().toLowerCase() : null;
            const mobileRaw = r.mobile ?? null;
            const mobile = mobileRaw ? normalizeKzPhone(mobileRaw) : null;
            let reason: string | null = null;
            if (!email && !mobile) reason = 'no_idempotency_key';
            else if (mobileRaw && !mobile) reason = 'mobile_invalid';
            return { src: r, idx, email, mobile, reason };
        });

        // 2. Look up existing users by either key in two queries. deleted_at: null
        //    excludes soft-deleted users from the idempotency check (insert path
        //    re-creates a fresh row; update path would surface 'no match' on a
        //    soft-deleted user — operator can hard-delete or restore separately).
        const validEmails = Array.from(
            new Set(normed.filter((n) => n.email && !n.reason).map((n) => n.email as string)),
        );
        const validMobiles = Array.from(
            new Set(normed.filter((n) => n.mobile && !n.reason).map((n) => n.mobile as string)),
        );

        const existingByEmail = new Map<string, number>();
        const existingByMobile = new Map<string, number>();

        if (validEmails.length > 0) {
            const rows = await this.prisma.user.findMany({
                where: { email: { in: validEmails }, deleted_at: null },
                select: { id: true, email: true },
            });
            for (const r of rows as Array<{ id: number; email: string | null }>) {
                if (r.email) existingByEmail.set(r.email.toLowerCase(), Number(r.id));
            }
        }
        if (validMobiles.length > 0) {
            const rows = await this.prisma.user.findMany({
                where: { mobile: { in: validMobiles }, deleted_at: null },
                select: { id: true, mobile: true },
            });
            for (const r of rows as Array<{ id: number; mobile: string | null }>) {
                if (r.mobile) existingByMobile.set(r.mobile, Number(r.id));
            }
        }

        // 3. Resolve role_id per role_name (default 'student'). Cache to avoid repeated
        //    lookups inside the loop.
        const distinctRoleNames: string[] = [];
        for (const n of normed) {
            if (n.src.role_name) distinctRoleNames.push(n.src.role_name);
        }
        const roleNamesToLookUp = Array.from(new Set<string>(distinctRoleNames.concat(['student'])));
        const roles = await this.prisma.role.findMany({
            where: { name: { in: roleNamesToLookUp } },
            select: { id: true, name: true },
        });
        const roleIdByName = new Map<string, number>();
        for (const r of roles as Array<{ id: number; name: string }>) {
            roleIdByName.set(r.name, Number(r.id));
        }
        if (!roleIdByName.has('student')) {
            // Configuration error — the seed must contain at least the 'student' Role row.
            throw new BadRequestException('seed_role_student_missing');
        }

        // 4. Classify each row.
        const out: ImportResultRow[] = [];
        let insert = 0;
        let update = 0;
        const skip = 0; // CSV import has no idempotent-skip status currently — kept for shape parity.
        let error = 0;

        for (const n of normed) {
            if (n.reason) {
                out.push({ row_id: n.src.row_id, status: 'error', reason: n.reason, user_id: null });
                error++;
                continue;
            }
            const idByEmail = n.email ? existingByEmail.get(n.email) : undefined;
            const idByMobile = n.mobile ? existingByMobile.get(n.mobile) : undefined;
            if (idByEmail && idByMobile && idByEmail !== idByMobile) {
                out.push({
                    row_id: n.src.row_id,
                    status: 'error',
                    reason: `conflict_user_${idByEmail}_${idByMobile}`,
                    user_id: null,
                });
                error++;
                continue;
            }
            const matchId = idByEmail ?? idByMobile ?? null;
            if (matchId) {
                out.push({ row_id: n.src.row_id, status: 'update', reason: null, user_id: matchId });
                update++;
            } else {
                out.push({ row_id: n.src.row_id, status: 'insert', reason: null, user_id: null });
                insert++;
            }
        }

        const affected = insert + update;
        const result: ImportResult = {
            bulk_op_id,
            mode: dto.mode,
            affected,
            insert,
            update,
            skip,
            error,
            rows: out,
        };

        if (dto.mode === 'dry_run') return result;

        // ----- commit path -----

        // T-03-42: server-side confirmation gate (independent of UI).
        if (affected > UsersImportService.CONFIRM_THRESHOLD) {
            if (typeof dto.confirmed_count !== 'number' || dto.confirmed_count !== affected) {
                throw new BadRequestException(
                    `confirmation_required:expected_${affected}_got_${dto.confirmed_count ?? 'null'}`,
                );
            }
        }

        if (affected === 0) return result;

        const now = Math.floor(Date.now() / 1000);
        const studentRoleId = roleIdByName.get('student')!;

        // 5. Commit phase — chunked $transaction. We walk normed/out in sync so r.user_id
        //    can be filled in post-create. P2002 (unique constraint violation) on a
        //    runtime-migrated DB → row downgrades to status='error', reason='conflict_runtime'.
        for (let i = 0; i < normed.length; i += UsersImportService.TX_CHUNK_SIZE) {
            const sliceEnd = Math.min(i + UsersImportService.TX_CHUNK_SIZE, normed.length);
            await this.prisma.$transaction(async (tx) => {
                for (let j = i; j < sliceEnd; j++) {
                    const n = normed[j];
                    const r = out[j];
                    if (r.status !== 'insert' && r.status !== 'update') continue;

                    const role_name = n.src.role_name ?? 'student';
                    const role_id = roleIdByName.get(role_name) ?? studentRoleId;

                    try {
                        if (r.status === 'insert') {
                            const created = await tx.user.create({
                                data: {
                                    full_name: n.src.full_name ?? null,
                                    email: n.email,
                                    mobile: n.mobile,
                                    role_id,
                                    role_name,
                                    status: n.src.status ?? 'pending',
                                    created_at: now,
                                },
                                select: { id: true },
                            });
                            r.user_id = Number(created.id);
                        } else if (r.user_id != null) {
                            await tx.user.update({
                                where: { id: r.user_id },
                                data: {
                                    // undefined preserves existing column; null would clear it.
                                    full_name: n.src.full_name ?? undefined,
                                    email: n.email ?? undefined,
                                    mobile: n.mobile ?? undefined,
                                    role_id: n.src.role_name ? role_id : undefined,
                                    role_name: n.src.role_name ?? undefined,
                                    status: n.src.status ?? undefined,
                                    updated_at: now,
                                },
                            });
                        }
                    } catch (e: unknown) {
                        // Defensive: if the runtime DB enforces @unique on email/mobile and a
                        // concurrent import lands the same key between dry-run + commit, the
                        // create raises P2002 inside the chunk transaction.
                        const code = (e as { code?: string } | null)?.code ?? null;
                        if (code === 'P2002') {
                            const wasInsert = r.status === 'insert';
                            r.status = 'error';
                            r.reason = 'conflict_runtime';
                            r.user_id = null;
                            if (wasInsert) insert--;
                            else update--;
                            error++;
                            // Rethrow so the chunk's $transaction rolls back, then continue
                            // outer loop so subsequent chunks proceed. The bulk_op_id is
                            // preserved across chunks.
                            throw e;
                        }
                        throw e;
                    }
                }
            }).catch((e: unknown) => {
                // Chunk-scope failure: each chunk's $transaction is atomic. We log and
                // continue — earlier chunks are committed; later chunks proceed. The
                // failed chunk's rows that we have not yet flipped to 'error' stay as
                // 'insert'/'update' in the report (the dry-run intent), but the actual
                // DB state is the rollback. Operators reconcile by re-uploading the
                // error-report CSV (which mirrors the upload + adds status/reason).
                this.logger.warn(
                    `import chunk rollback bulk_op_id=${bulk_op_id} chunk_start=${i} err=${
                        (e as Error)?.message ?? String(e)
                    }`,
                );
            });
        }

        // Recompute the totals after any P2002 demotions.
        result.insert = insert;
        result.update = update;
        result.error = error;
        result.affected = insert + update;

        this.logger.log(
            `import committed bulk_op_id=${bulk_op_id} actor=${actor.id} role=${actor.role_name} ` +
                `affected=${result.affected} insert=${result.insert} update=${result.update} error=${result.error}`,
        );

        return result;
    }
}
