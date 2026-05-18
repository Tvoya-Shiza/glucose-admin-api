import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { UsersDetailService } from './users-detail.service';
import { normalizeKzPhone } from './utils/normalize-phone';
import { CreateUserDto } from './dto/create-user.dto';
import type { UserDetailDto } from './dto/user-detail.dto';

/**
 * Single-user creation (admin-only). Sister endpoint to `users-import.service.ts` —
 * the bulk path covers CSV uploads, this path covers manual one-off operator creates
 * from the admin UI.
 *
 * Field rules:
 *   - At least one of `email` / `mobile` MUST be present (idempotency key parity with
 *     CSV import). Service-level rather than DTO-level so the conflict-detection
 *     and missing-key checks share one error code namespace.
 *   - `role_name` resolves to `Role.id` via the Role table (matches `users-role.service.ts`
 *     pattern); 400 if no Role row matches.
 *   - `password` is bcrypt-hashed (cost 10 — matches `auth.service.ts`). When omitted,
 *     the column stays NULL and the user logs in via SMS-code (public registration parity).
 *
 * Conflict semantics:
 *   - Pre-flight `findFirst` on email + mobile (deleted_at: null) — surfaces a
 *     `ConflictException` with `users.email_taken` / `users.mobile_taken` codes BEFORE
 *     hitting the DB write.
 *   - Defensive try/catch on the create — runtime DB may have @unique constraints
 *     not yet reflected in dev migrations; P2002 → 409 with the same code shape.
 *
 * Returned shape: full `UserDetailDto` via `UsersDetailService.detail()` so the admin-client
 * can navigate straight to the new user's detail page on success.
 */
@Injectable()
export class UsersCreateService {
    private readonly logger = new Logger(UsersCreateService.name);

    public static readonly BCRYPT_COST = 10;

    constructor(
        private readonly prisma: PrismaService,
        private readonly detailService: UsersDetailService,
    ) {}

    public async create(actor: ScopeActor, dto: CreateUserDto): Promise<UserDetailDto> {
        // 1. Normalize keys.
        const email = dto.email ? dto.email.trim().toLowerCase() : null;
        const mobileRaw = dto.mobile ? dto.mobile.trim() : null;
        const mobile = mobileRaw ? normalizeKzPhone(mobileRaw) : null;

        if (mobileRaw && !mobile) {
            throw new BadRequestException('users.mobile_invalid');
        }
        if (!email && !mobile) {
            throw new BadRequestException('users.email_or_mobile_required');
        }

        // 2. Conflict pre-check (deleted_at: null — soft-deleted rows can be re-inserted).
        if (email) {
            const dup = await this.prisma.user.findFirst({
                where: { email, deleted_at: null },
                select: { id: true },
            });
            if (dup) throw new ConflictException('users.email_taken');
        }
        if (mobile) {
            const dup = await this.prisma.user.findFirst({
                where: { mobile, deleted_at: null },
                select: { id: true },
            });
            if (dup) throw new ConflictException('users.mobile_taken');
        }

        // 3. Resolve role_id via Role.code (canonical discriminator that matches
        //    User.role_name semantics). The previous version looked up by Role.name
        //    (Russian display label "Администратор") and self-healed missing rows,
        //    which produced duplicate Role rows with empty code on partial seeds.
        const roleRow = await this.prisma.role.findFirst({
            where: { code: dto.role_name },
            select: { id: true },
        });
        if (!roleRow) {
            throw new BadRequestException('users.role_not_found');
        }
        const resolvedRoleId = Number(roleRow.id);

        // 4. Hash password (when provided).
        const password = dto.password ? await bcrypt.hash(dto.password, UsersCreateService.BCRYPT_COST) : null;

        const now = Math.floor(Date.now() / 1000);
        let createdId: number;
        try {
            const created = await this.prisma.user.create({
                data: {
                    full_name: dto.full_name ?? null,
                    email,
                    mobile,
                    password,
                    role_id: resolvedRoleId,
                    role_name: dto.role_name,
                    status: dto.status ?? 'active',
                    created_at: now,
                },
                select: { id: true },
            });
            createdId = Number(created.id);
        } catch (e: unknown) {
            const code = (e as { code?: string } | null)?.code ?? null;
            if (code === 'P2002') {
                // Race vs concurrent create on the same key. Surface the same code shape
                // as the pre-flight check so callers can render one i18n key.
                const target = (e as { meta?: { target?: string[] } }).meta?.target ?? [];
                if (target.includes('email')) throw new ConflictException('users.email_taken');
                if (target.includes('mobile')) throw new ConflictException('users.mobile_taken');
                throw new ConflictException('users.conflict');
            }
            throw e;
        }

        this.logger.log(
            `user created id=${createdId} role=${dto.role_name} actor=${actor.id} actor_role=${actor.role_name}`,
        );

        return this.detailService.detail(actor, createdId);
    }
}
