import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { ChangeBlogAuthorDto } from './dto/change-author.dto';
import { BlogsDetailService, type BlogDetail } from './blogs-detail.service';
import { BlogsCacheService } from './utils/blogs-cache.service';
import { BLOGS_INVALIDATE_PATTERN } from './utils/blogs-cache';

/**
 * BLG-03 — blog author reassignment (Plan 04 / D-11).
 *
 * High-trust mutation: changes Blog.author_id. Mirrors Phase 3 Plan 04 UsersRoleService
 * posture for admin-escalation-shaped writes.
 *
 * Defensive guards (mirroring threat model T-07-04-03 / T-07-04-04):
 *   - admin-only (belt-and-braces alongside RolesGuard at controller).
 *   - existence check on Blog (404 'blogs.not_found').
 *   - target user existence + role check: `role_name IN ('admin','teacher')` (D-11
 *     locked policy — students are never authors; curators don't author content).
 *   - server-side confirmation gate: `confirmation === String(blog.id)` whenever
 *     the request actually changes author_id (T-07-04-04 — UI's TypeTheCountConfirmation
 *     is UX, server is the gate).
 *   - no-op short-circuit when current `author_id === dto.author_id`.
 *
 * Atomic write: wrapped in `$transaction` even though it's a single update so future
 * cascades (audit-row replay, follow-up notifications) can append without changing
 * call shape (mirrors UsersRoleService pattern).
 *
 * Cache invalidation: BLOGS_INVALIDATE_PATTERN after any successful change.
 *
 * Race posture (T-07-04-11 — accepted): last-write-wins on Blog.updated_at. Concurrent
 * author edits won't deadlock, but the loser's audit row will misrepresent the
 * "before" author. Documented; revisit if it becomes operationally painful.
 */
@Injectable()
export class BlogsAuthorService {
    private readonly logger = new Logger(BlogsAuthorService.name);

    /** D-11 (locked): valid target authors for a Blog row. */
    public static readonly ALLOWED_AUTHOR_ROLES: ReadonlyArray<string> = ['admin', 'teacher'];

    constructor(
        private readonly prisma: PrismaService,
        private readonly cache: BlogsCacheService,
        private readonly detailSvc: BlogsDetailService,
    ) {}

    public async changeAuthor(actor: ScopeActor, blogId: number, dto: ChangeBlogAuthorDto): Promise<BlogDetail> {
        // Belt-and-braces — RolesGuard already enforces admin-only at the controller.
        if (actor.role_name !== 'admin') {
            throw new ForbiddenException('admin_only');
        }

        // 1. Blog must exist.
        const blog: any = await this.prisma.blog.findFirst({
            where: { id: blogId },
            select: { id: true, author_id: true },
        });
        if (!blog) throw new NotFoundException('blogs.not_found');

        // 2. No-op short-circuit.
        if (Number(blog.author_id) === Number(dto.author_id)) {
            return this.detailSvc.getDetail(blogId);
        }

        // 3. Target user must exist, not be soft-deleted, and have a permitted role.
        const target: any = await this.prisma.user.findFirst({
            where: { id: dto.author_id, deleted_at: null },
            select: { id: true, role_name: true },
        });
        if (!target) throw new NotFoundException('blogs.author_not_found');
        if (!BlogsAuthorService.ALLOWED_AUTHOR_ROLES.includes(target.role_name)) {
            throw new BadRequestException('blogs.target_must_be_staff_author');
        }

        // 4. Server-side confirmation gate (T-07-04-04). UI's TypeTheCountConfirmation
        //    is UX only — the server independently re-validates `confirmation === String(blogId)`
        //    for any change that actually flips author_id (mirrors Phase 3 T-03-32).
        if (!dto.confirmation || dto.confirmation.trim() !== String(blogId)) {
            throw new BadRequestException('blogs.author_change_confirmation_required');
        }

        const now = Math.floor(Date.now() / 1000);

        // 5. Atomic update wrapped in $transaction (future-cascade friendly).
        await this.prisma.$transaction([
            this.prisma.blog.update({
                where: { id: blogId },
                data: { author_id: dto.author_id, updated_at: now },
            }),
        ]);

        await this.cache.invalidate(BLOGS_INVALIDATE_PATTERN);

        this.logger.log(
            `changeAuthor committed blog=${blogId} actor=${actor.id} role=${actor.role_name} ` +
                `previous_author=${Number(blog.author_id)} new_author=${dto.author_id}` +
                (dto.reason ? ` reason=${JSON.stringify(dto.reason)}` : ''),
        );

        return this.detailSvc.getDetail(blogId);
    }
}
