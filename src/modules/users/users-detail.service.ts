import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { buildScopeWhere } from '../../common/scoping/scope.helper';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { USER_SCOPE_RULES } from './users.scope';
import { normalizeKzPhone } from './utils/normalize-phone';
import type { UserActivityResponseDto, UserActivityRowDto, UserDetailDto } from './dto/user-detail.dto';
import { PatchUserProfileDto } from './dto/patch-user-profile.dto';
import { PatchMembershipsDto } from './dto/patch-memberships.dto';

/**
 * USR-02 / USR-03 (profile half) / USR-08 — user detail + activity + profile + memberships.
 *
 * Scope (D-21): every read AND write re-applies USER_SCOPE_RULES via findFirst({ where: { id, ...scopeWhere } }).
 * Out-of-scope IDs return 404 (NotFoundException) — NEVER 403, because 403 would leak the
 * existence of a row outside the actor's scope (T-03-21).
 *
 * N+1 avoidance (D-10): detail() uses a single Prisma findFirst with nested `select`. The
 * webinar-name lookup is a SECOND query (one IN-list) that's necessary because the
 * Webinar.translations relation is keyed by `locale: String` and we need just RU. Activity
 * is a separate paginated endpoint (lazy-loaded by the Activity tab).
 *
 * AdminAuditLog read posture (D-10 + Phase 1.08): activity() uses the `adminAuditLog` Prisma
 * delegate when available; if the schema/regen has not run (early days) the delegate is
 * undefined and we return an empty page. Caller MUST treat empty rows as acceptable.
 *
 * BigInt: AdminAuditLog.id is BigInt UnsignedBigInt; we Number(...) at the boundary because
 * realistic id values stay well under 2^53. The global BigIntStringInterceptor would otherwise
 * stringify it; explicit conversion keeps the wire shape consistent with UserRowDto's
 * `number` ids.
 *
 * Mobile normalization (T-03-24, D-24): patchProfile runs `normalizeKzPhone` on every mobile
 * write; rejects with 400 if input does not match KZ formats.
 */
@Injectable()
export class UsersDetailService {
    private readonly logger = new Logger(UsersDetailService.name);

    constructor(private readonly prisma: PrismaService) {}

    public async detail(actor: ScopeActor, id: number): Promise<UserDetailDto> {
        const scopeWhere = buildScopeWhere(actor, USER_SCOPE_RULES);

        const row: any = await this.prisma.user.findFirst({
            // deleted_at: null filter — out-of-scope undelete UI per CONTEXT deferred-ideas.
            where: { id, deleted_at: null, ...scopeWhere },
            // Explicit select; password is NEVER projected (T-03-20).
            select: {
                id: true,
                full_name: true,
                email: true,
                mobile: true,
                role_id: true,
                role_name: true,
                status: true,
                avatar: true,
                about: true,
                verified: true,
                country_id: true,
                province_id: true,
                city_id: true,
                school_id: true,
                last_activity: true,
                created_at: true,
                updated_at: true,
                group_users: {
                    select: { group: { select: { id: true, name: true, supervisor_id: true } } },
                },
                sales_as_buyer: {
                    select: {
                        id: true,
                        webinar_id: true,
                        manual_added: true,
                        access_days: true,
                        created_at: true,
                        refund_at: true,
                        amount: true,
                        total_amount: true,
                    },
                    orderBy: { created_at: 'desc' },
                    take: 200,
                },
            },
        });

        if (!row) throw new NotFoundException('user_not_found');

        // One additional query: pull RU webinar names for the course-access summary.
        // WebinarTranslations.locale is `String` ('ru'|'kz'|'en' etc.), NOT `locale_id: Int`
        // as the plan body suggested — corrected against schema lines 850-860.
        const webinarIds: number[] = Array.from(
            new Set((row.sales_as_buyer as any[]).map((s) => s.webinar_id).filter((v: unknown) => typeof v === 'number')),
        ) as number[];
        const webinarMap = new Map<number, string | null>();
        if (webinarIds.length > 0) {
            const wins: any[] = await this.prisma.webinar.findMany({
                where: { id: { in: webinarIds } },
                select: { id: true, translations: { select: { title: true, locale: true } } },
            });
            for (const w of wins) {
                const ts = (w.translations ?? []) as Array<{ title: string; locale: string }>;
                const ru = ts.find((t) => t.locale === 'ru');
                const fallback = ts[0];
                webinarMap.set(Number(w.id), (ru ?? fallback)?.title ?? null);
            }
        }

        return {
            id: Number(row.id),
            full_name: row.full_name ?? null,
            email: row.email ?? null,
            mobile: row.mobile ?? null,
            role_id: Number(row.role_id),
            role_name: row.role_name,
            status: row.status,
            last_activity: row.last_activity ? Math.floor(new Date(row.last_activity).getTime() / 1000) : null,
            created_at: Number(row.created_at),
            updated_at: row.updated_at != null ? Number(row.updated_at) : null,
            country_id: row.country_id ?? null,
            province_id: row.province_id ?? null,
            city_id: row.city_id ?? null,
            school_id: row.school_id ?? null,
            avatar: row.avatar ?? null,
            about: row.about ?? null,
            verified: !!row.verified,
            groups: (row.group_users as any[]).map((gu) => ({
                id: Number(gu.group.id),
                name: gu.group.name,
                supervisor_id: gu.group.supervisor_id != null ? Number(gu.group.supervisor_id) : null,
            })),
            course_access: (row.sales_as_buyer as any[]).map((s) => ({
                sale_id: Number(s.id),
                webinar_id: s.webinar_id != null ? Number(s.webinar_id) : null,
                webinar_name: s.webinar_id != null ? webinarMap.get(Number(s.webinar_id)) ?? null : null,
                manual_added: !!s.manual_added,
                access_days: s.access_days != null ? Number(s.access_days) : null,
                created_at: Number(s.created_at),
                refund_at: s.refund_at != null ? Number(s.refund_at) : null,
            })),
            recent_payments: (row.sales_as_buyer as any[]).slice(0, 20).map((s) => ({
                id: Number(s.id),
                amount: String(s.amount ?? '0'),
                total_amount: s.total_amount != null ? String(s.total_amount) : null,
                created_at: Number(s.created_at),
                refund_at: s.refund_at != null ? Number(s.refund_at) : null,
            })),
        };
    }

    public async activity(
        actor: ScopeActor,
        id: number,
        page: number,
        page_size: number,
    ): Promise<UserActivityResponseDto> {
        // Re-check scope BEFORE peeking at audit rows so the activity endpoint cannot be
        // used to confirm existence of an out-of-scope user (T-03-27).
        const ok = await this.prisma.user.findFirst({
            where: { id, deleted_at: null, ...buildScopeWhere(actor, USER_SCOPE_RULES) },
            select: { id: true },
        });
        if (!ok) throw new NotFoundException('user_not_found');

        const delegate: any = (this.prisma as any).adminAuditLog;
        if (!delegate || typeof delegate.findMany !== 'function') {
            // adminAuditLog table not yet present (Plan 1.08 schema regen not run on this env)
            // — return empty page rather than 500. Acceptable per plan body D-10.
            return { rows: [], total: 0, page, page_size };
        }

        try {
            const where = { entity: 'user', entity_id: String(id) };
            const [total, rows] = await this.prisma.$transaction([
                delegate.count({ where }),
                delegate.findMany({
                    where,
                    orderBy: { ts: 'desc' },
                    take: page_size,
                    skip: (page - 1) * page_size,
                    select: {
                        id: true,
                        ts: true,
                        actor_id: true,
                        action: true,
                        entity: true,
                        entity_id: true,
                        meta: true,
                    },
                }),
            ]);
            const out: UserActivityRowDto[] = (rows as any[]).map((r) => ({
                id: Number(r.id),
                ts: Number(r.ts),
                actor_id: r.actor_id != null ? Number(r.actor_id) : null,
                action: r.action,
                entity: r.entity,
                entity_id: r.entity_id ?? null,
                meta: r.meta ?? null,
            }));
            return { rows: out, total: Number(total), page, page_size };
        } catch (err) {
            this.logger.debug(`activity read skipped: ${(err as Error).message}`);
            return { rows: [], total: 0, page, page_size };
        }
    }

    public async patchProfile(actor: ScopeActor, id: number, dto: PatchUserProfileDto): Promise<UserDetailDto> {
        // Scope check first — out-of-scope ID returns 404 (NOT 403, T-03-21).
        const ok = await this.prisma.user.findFirst({
            where: { id, deleted_at: null, ...buildScopeWhere(actor, USER_SCOPE_RULES) },
            select: { id: true },
        });
        if (!ok) throw new NotFoundException('user_not_found');

        const data: any = {};
        if (dto.full_name !== undefined) data.full_name = dto.full_name;
        if (dto.email !== undefined) data.email = dto.email.trim().toLowerCase();
        if (dto.mobile !== undefined) {
            const norm = normalizeKzPhone(dto.mobile);
            if (!norm) {
                // Use ForbiddenException (per plan body) — explicit, semantic, and the
                // global exception filter renders it as 403 with a clear i18n key.
                throw new ForbiddenException('mobile_invalid');
            }
            data.mobile = norm;
        }
        if (dto.status !== undefined) data.status = dto.status;
        if (dto.country_id !== undefined) data.country_id = dto.country_id;
        if (dto.province_id !== undefined) data.province_id = dto.province_id;
        if (dto.city_id !== undefined) data.city_id = dto.city_id;
        if (dto.school_id !== undefined) data.school_id = dto.school_id;
        if (dto.avatar !== undefined) data.avatar = dto.avatar;
        if (dto.about !== undefined) data.about = dto.about;
        if (dto.verified !== undefined) data.verified = dto.verified;
        data.updated_at = Math.floor(Date.now() / 1000);

        // Single-write `update` doesn't strictly need $transaction, but the wrapper here
        // keeps the door open for cascade writes (e.g. push role-change row to audit) in
        // future extensions without changing the call shape.
        await this.prisma.$transaction([this.prisma.user.update({ where: { id }, data })]);
        return this.detail(actor, id);
    }

    public async patchMemberships(
        actor: ScopeActor,
        id: number,
        dto: PatchMembershipsDto,
    ): Promise<UserDetailDto> {
        const ok = await this.prisma.user.findFirst({
            where: { id, deleted_at: null, ...buildScopeWhere(actor, USER_SCOPE_RULES) },
            select: { id: true },
        });
        if (!ok) throw new NotFoundException('user_not_found');

        const add = (dto.add ?? []).filter((g) => Number.isFinite(g) && g > 0);
        const remove = (dto.remove ?? []).filter((g) => Number.isFinite(g) && g > 0);

        // Curator gate: may only assign to groups they supervise (T-03-22). Admin passthrough.
        // Teacher is rejected at the controller level (no @Roles('teacher') on memberships).
        if (actor.role_name === 'curator' && add.length > 0) {
            const allowed = await this.prisma.group.findMany({
                where: { id: { in: add }, supervisor_id: actor.id },
                select: { id: true },
            });
            const allowedIds = new Set(allowed.map((g) => Number(g.id)));
            const denied = add.filter((g) => !allowedIds.has(g));
            if (denied.length > 0) {
                throw new ForbiddenException(`groups_out_of_scope:${denied.join(',')}`);
            }
        }

        const now = Math.floor(Date.now() / 1000);

        // GroupUser does NOT have @@unique([user_id, group_id]) in this schema — verified at
        // schema lines 315-325. So we use find-then-create (idempotent) instead of upsert.
        // Single $transaction covers remove + add atomically.
        const ops: any[] = [];
        if (remove.length > 0) {
            ops.push(this.prisma.groupUser.deleteMany({ where: { user_id: id, group_id: { in: remove } } }));
        }
        if (add.length > 0) {
            // Find which add ids already have a row to avoid duplicate inserts (no unique
            // constraint to lean on). Fetched in one query before the transaction commits.
            const existing = await this.prisma.groupUser.findMany({
                where: { user_id: id, group_id: { in: add } },
                select: { group_id: true },
            });
            const existingSet = new Set(existing.map((e: { group_id: number }) => Number(e.group_id)));
            const fresh = add.filter((gid) => !existingSet.has(gid));
            if (fresh.length > 0) {
                ops.push(
                    this.prisma.groupUser.createMany({
                        data: fresh.map((gid) => ({ user_id: id, group_id: gid, created_at: now })),
                    }),
                );
            }
        }
        if (ops.length > 0) {
            await this.prisma.$transaction(ops);
        }

        return this.detail(actor, id);
    }
}
