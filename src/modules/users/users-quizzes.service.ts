import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { buildScopeWhere } from '../../common/scoping/scope.helper';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { PrismaService } from '../../prisma/prisma.service';
import type { UserQuizzesResponseDto } from './dto/user-quizzes.dto';
import { USER_SCOPE_RULES } from './users.scope';

/**
 * Quiz access + result feed for a single user. Out-of-scope id returns 404
 * (NOT 403) per the same T-03-21 posture as `UsersDetailService.detail`.
 *
 * Access rows come from `Sale.buyer_id` where `quiz_id` or `quiz_badge_id` is
 * non-null and `refund_at IS NULL`. Result rows come from `QuizResult.user_id`
 * with a 200-row safety cap (waiting attempts + history surface).
 */
@Injectable()
export class UsersQuizzesService {
    private readonly logger = new Logger(UsersQuizzesService.name);

    constructor(private readonly prisma: PrismaService) {}

    public async list(actor: ScopeActor, userId: number): Promise<UserQuizzesResponseDto> {
        const scopeWhere = buildScopeWhere(actor, USER_SCOPE_RULES);
        const ok = await this.prisma.user.findFirst({
            where: { id: userId, deleted_at: null, ...scopeWhere },
            select: { id: true },
        });
        if (!ok) throw new NotFoundException('user_not_found');

        const [salesRaw, resultsRaw] = await this.prisma.$transaction([
            this.prisma.sale.findMany({
                where: {
                    buyer_id: userId,
                    refund_at: null,
                    OR: [{ quiz_id: { not: null } }, { quiz_badge_id: { not: null } }],
                },
                select: {
                    id: true,
                    quiz_id: true,
                    quiz_badge_id: true,
                    manual_added: true,
                    access_days: true,
                    created_at: true,
                    refund_at: true,
                },
                orderBy: { created_at: 'desc' },
                take: 200,
            }),
            this.prisma.quizResult.findMany({
                where: { user_id: userId },
                select: {
                    id: true,
                    quiz_id: true,
                    status: true,
                    user_grade: true,
                    created_at: true,
                },
                orderBy: { created_at: 'desc' },
                take: 200,
            }),
        ]);

        const sales = salesRaw as Array<{
            id: number;
            quiz_id: number | null;
            quiz_badge_id: number | null;
            manual_added: boolean;
            access_days: number | null;
            created_at: number;
            refund_at: number | null;
        }>;
        const results = resultsRaw as Array<{
            id: number;
            quiz_id: number;
            status: 'waiting' | 'passed' | 'failed';
            user_grade: number | null;
            created_at: number;
        }>;

        const quizIds = new Set<number>();
        for (const s of sales) {
            if (s.quiz_id != null) quizIds.add(Number(s.quiz_id));
        }
        for (const r of results) {
            quizIds.add(Number(r.quiz_id));
        }
        const badgeIds = new Set<number>();
        for (const s of sales) {
            if (s.quiz_badge_id != null) badgeIds.add(Number(s.quiz_badge_id));
        }

        const quizNameMap = await this.resolveQuizNames(Array.from(quizIds));
        const badgeNameMap = await this.resolveBadgeNames(Array.from(badgeIds));

        const access: UserQuizzesResponseDto['access'] = sales.map((s) => {
            const isBadge = s.quiz_id == null && s.quiz_badge_id != null;
            const name = isBadge
                ? s.quiz_badge_id != null
                    ? badgeNameMap.get(Number(s.quiz_badge_id)) ?? null
                    : null
                : s.quiz_id != null
                    ? quizNameMap.get(Number(s.quiz_id)) ?? null
                    : null;
            return {
                sale_id: Number(s.id),
                quiz_id: s.quiz_id != null ? Number(s.quiz_id) : null,
                quiz_badge_id: s.quiz_badge_id != null ? Number(s.quiz_badge_id) : null,
                quiz_name: name,
                kind: isBadge ? 'quiz_badge' : 'quiz',
                manual_added: !!s.manual_added,
                access_days: s.access_days != null ? Number(s.access_days) : null,
                created_at: Number(s.created_at),
                refund_at: s.refund_at != null ? Number(s.refund_at) : null,
            };
        });

        const out_results: UserQuizzesResponseDto['results'] = results.map((r) => ({
            id: Number(r.id),
            quiz_id: Number(r.quiz_id),
            quiz_name: quizNameMap.get(Number(r.quiz_id)) ?? null,
            status: r.status,
            user_grade: r.user_grade != null ? Number(r.user_grade) : null,
            created_at: Number(r.created_at),
        }));

        return { access, results: out_results };
    }

    private async resolveQuizNames(ids: number[]): Promise<Map<number, string | null>> {
        const map = new Map<number, string | null>();
        if (ids.length === 0) return map;
        const rows = (await this.prisma.quizzes.findMany({
            where: { id: { in: ids } },
            select: { id: true, translations: { select: { locale: true, title: true } } },
        })) as Array<{ id: number; translations: Array<{ locale: string; title: string }> }>;
        for (const r of rows) {
            const ts = r.translations ?? [];
            const kz = ts.find((t) => t.locale === 'kz');
            map.set(Number(r.id), (kz ?? ts[0])?.title ?? null);
        }
        return map;
    }

    private async resolveBadgeNames(ids: number[]): Promise<Map<number, string | null>> {
        const map = new Map<number, string | null>();
        if (ids.length === 0) return map;
        const rows = (await this.prisma.quizBadge.findMany({
            where: { id: { in: ids } },
            select: { id: true, translations: { select: { locale: true, title: true } } },
        })) as Array<{ id: number; translations: Array<{ locale: string; title: string }> }>;
        for (const r of rows) {
            const ts = r.translations ?? [];
            const kz = ts.find((t) => t.locale === 'kz');
            map.set(Number(r.id), (kz ?? ts[0])?.title ?? null);
        }
        return map;
    }
}
