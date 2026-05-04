import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { buildScopeWhere } from '../../common/scoping/scope.helper';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { PUSH_AUDIENCE_PREFIX } from '../push/utils/push-cache';
import { AUDIENCE_SCOPE_RULES } from './audience.scope';
import { AudienceCacheService } from './utils/audience-cache.service';
import type {
    AudiencePreviewResult,
    AudienceResolveResult,
    ResolvedRecipient,
} from './audience.types';
import type {
    AudienceFilterDto,
    AudienceShapeDto,
} from './dto/audience-preview.dto';

/**
 * AudienceService — Phase 8 Plan 02. Reusable audience resolver shared by:
 *   - Push broadcast (Plan 03) — calls resolve() with the firing actor
 *   - Push schedule cron (Plan 04) — calls resolve() with the SCHEDULED-PUSH CREATOR's
 *     actor identity, so RBAC narrowing applies even for cron-fired sends
 *   - Mailings send (Plan 05) — same contract
 *
 * Resolution semantics:
 *   - Filters within `audience.filters[]` are AND-combined: a user must match
 *     EVERY filter to be included (D-01).
 *   - `exclude_no_fcm` drops users without an active fcm_token (push surfaces).
 *   - `exclude_no_email` drops users without User.email (mailing surface).
 *   - `exclude_unsubscribed` is reserved (no unsubscribe table in v1; deferred).
 *   - Soft-deleted users (deleted_at != null) are ALWAYS excluded.
 *   - RBAC narrowing via AUDIENCE_SCOPE_RULES applied per-actor — defense in
 *     depth even though the controller is admin-only (curator/teacher would
 *     still narrow to their own scope if a future plan exposes them).
 *
 * Caps:
 *   - MAX_RECIPIENTS = 100_000. Beyond this, resolve() truncates and sets
 *     `capped: true`. Plan 03 broadcast paginates over MAX_BATCH (250) inside
 *     this cap.
 *
 * Hashing:
 *   - audience_hash = sha256(canonical-JSON(audience)). Used as Redis cache-key
 *     suffix (D-18), audit-log meta (D-17), and Plan 03 attempt_id seed.
 */
@Injectable()
export class AudienceService {
    private readonly logger = new Logger(AudienceService.name);

    /** D-18: hard cap on a single resolve() call. Plans 03/04/05 paginate inside this. */
    public static readonly MAX_RECIPIENTS = 100_000;

    constructor(
        private readonly prisma: PrismaService,
        private readonly cache: AudienceCacheService,
    ) {}

    /**
     * Resolve an AudienceShape into a deduplicated recipient list scoped to the actor.
     *
     * Returns:
     *   - recipients: ResolvedRecipient[]    deduplicated by User.id
     *   - audience_hash: string              sha256 of canonical AudienceShape JSON
     *   - count: number                      equals recipients.length
     *   - capped: boolean                    true if MAX_RECIPIENTS was hit
     */
    public async resolve(audience: AudienceShapeDto, actor: ScopeActor): Promise<AudienceResolveResult> {
        const audience_hash = this.hash(audience);
        const filterWheres = audience.filters.map((f) => this.filterToWhere(f));

        // exclude_* flags + soft-delete exclusion + RBAC narrowing — all AND-combined.
        const wheres: Record<string, unknown>[] = [...filterWheres];
        if (audience.exclude_no_fcm) {
            wheres.push({ firebase_sessions: { some: { fcm_token: { not: null } } } });
        }
        if (audience.exclude_no_email) {
            wheres.push({ email: { not: null } });
        }
        // exclude_unsubscribed: deferred — no unsubscribe table in v1.

        // User.deleted_at is `Int?` (Unix seconds). null = active.
        wheres.push({ deleted_at: null });

        // Belt-and-braces RBAC narrowing — admin returns {}, curator/teacher narrow.
        wheres.push(buildScopeWhere(actor, AUDIENCE_SCOPE_RULES));

        const users = await this.prisma.user.findMany({
            where: { AND: wheres },
            select: {
                id: true,
                full_name: true,
                email: true,
                firebase_sessions: {
                    select: { fcm_token: true },
                    where: { fcm_token: { not: null } },
                    take: 1,
                },
            },
            orderBy: { id: 'asc' },
            // Fetch one extra to detect overflow.
            take: AudienceService.MAX_RECIPIENTS + 1,
        });

        const capped = users.length > AudienceService.MAX_RECIPIENTS;
        if (capped) {
            this.logger.warn(
                `audience.resolve hit MAX_RECIPIENTS cap (${AudienceService.MAX_RECIPIENTS}); ` +
                    `actor=${actor.id} role=${actor.role_name} audience_hash=${audience_hash}`,
            );
        }

        const slice = users.slice(0, AudienceService.MAX_RECIPIENTS);
        const recipients: ResolvedRecipient[] = slice.map((u) => ({
            id: u.id,
            full_name: u.full_name,
            email: u.email,
            has_fcm: u.firebase_sessions.length > 0,
            has_email: !!u.email,
        }));

        return { recipients, audience_hash, count: recipients.length, capped };
    }

    /**
     * Lightweight server-computed preview for the AudienceSelector UI.
     * Returns count + sample (first 5 by id asc) + cached flag.
     * Cached 30s under geonline-admin:push:audience:<actor.role>:<actor.id>:<hash> (D-18).
     *
     * The cache key is namespaced by actor identity so a curator's preview cache
     * cannot leak into an admin's preview (RBAC narrowing affects the result set).
     */
    public async preview(audience: AudienceShapeDto, actor: ScopeActor): Promise<AudiencePreviewResult> {
        const audience_hash = this.hash(audience);
        const cacheKey = `${PUSH_AUDIENCE_PREFIX}:${actor.role_name}:${actor.id}:${audience_hash}`;

        const { value, hit } = await this.cache.getOrSet(
            cacheKey,
            async () => {
                const resolved = await this.resolve(audience, actor);
                return {
                    count: resolved.count,
                    sample: resolved.recipients.slice(0, 5),
                    audience_hash: resolved.audience_hash,
                } as Omit<AudiencePreviewResult, 'cached'>;
            },
            AudienceCacheService.DEFAULT_TTL_SECONDS,
        );

        return { ...value, cached: hit };
    }

    /**
     * Deterministic sha256 of canonical AudienceShape JSON. Stable across
     * processes, key-order independent, recursive (nested objects sorted too).
     * Returned value is hex (64 chars).
     */
    public hash(audience: AudienceShapeDto): string {
        const canonical = this.canonicalize(audience);
        return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
    }

    private canonicalize(value: unknown): unknown {
        if (Array.isArray(value)) return value.map((v) => this.canonicalize(v));
        if (value && typeof value === 'object') {
            const out: Record<string, unknown> = {};
            for (const k of Object.keys(value as Record<string, unknown>).sort()) {
                out[k] = this.canonicalize((value as Record<string, unknown>)[k]);
            }
            return out;
        }
        return value;
    }

    private filterToWhere(filter: AudienceFilterDto): Record<string, unknown> {
        switch (filter.kind) {
            case 'group':
                return { group_users: { some: { group_id: { in: filter.group_ids ?? [] } } } };
            case 'role':
                return { role_name: { in: filter.roles ?? [] } };
            case 'region': {
                // RegionField is a column on User — User has NO single region_id, so
                // the filter targets one of country_id|province_id|city_id|district_id|school_id
                // (Plan 01 SUMMARY decision; verified against schema.prisma line 221-225).
                const field = filter.field as string;
                return { [field]: { in: filter.region_ids ?? [] } };
            }
            case 'cohort': {
                const p = filter.predicate;
                if (!p) return {};
                if (p.type === 'completed_course') {
                    return { sales_as_buyer: { some: { webinar_id: p.webinar_id, refund_at: null } } };
                }
                if (p.type === 'inactive_days') {
                    const cutoff = new Date(Date.now() - (p.days ?? 0) * 86_400_000);
                    return { OR: [{ last_activity: { lt: cutoff } }, { last_activity: null }] };
                }
                if (p.type === 'status') {
                    return { status: p.status };
                }
                return {};
            }
        }
    }
}
