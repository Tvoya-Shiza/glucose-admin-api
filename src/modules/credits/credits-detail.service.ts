import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { apiResponse } from '../../common/utils/api-response';
import { buildScopeWhere } from '../../common/scoping/scope.helper';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { CREDIT_SCOPE_RULES } from './credits.scope';
import { CreditsListService } from './credits-list.service';
import { CreditHistoryDto } from './dto/credit-history.dto';
import type { CreditHistoryRow, EligibleStudent } from './types/credits.types';
import { computePercent } from './utils/finalize';

/**
 * Credit detail reads (contract §credits CRUD):
 *
 *   GET /credits/:id                    — detail incl. lesson_item_ids + launches summary
 *   GET /credits/:id/history            — attempt history rows (credits.results_view)
 *   GET /credits/:id/eligible-students  — group members + pass/attempt state for the wizard
 */
@Injectable()
export class CreditsDetailService {
    private static readonly DEFAULT_PAGE_SIZE = 50;
    private static readonly MAX_PAGE_SIZE = 200;
    private static readonly LAUNCH_SUMMARY_LIMIT = 20;

    constructor(
        private readonly prisma: PrismaService,
        private readonly listService: CreditsListService,
    ) {}

    public async detail(actor: ScopeActor, id: bigint) {
        const r = await this.prisma.credit.findFirst({
            where: { id, deleted_at: null, ...(buildScopeWhere(actor, CREDIT_SCOPE_RULES) as object) },
            select: {
                id: true,
                title: true,
                description: true,
                scheduled_at: true,
                status: true,
                created_at: true,
                updated_at: true,
                group_id: true,
                course: { select: { id: true, translations: { select: { locale: true, title: true } } } },
                chapter: { select: { id: true, translations: { select: { locale: true, title: true } } } },
                group: { select: { id: true, name: true } },
                links: { select: { chapter_item_id: true }, orderBy: { id: 'asc' as const } },
                launches: {
                    orderBy: { created_at: 'desc' as const },
                    take: CreditsDetailService.LAUNCH_SUMMARY_LIMIT,
                    select: {
                        id: true,
                        status: true,
                        question_count: true,
                        duration_sec: true,
                        pass_type: true,
                        pass_value: true,
                        created_at: true,
                        curator: { select: { id: true, full_name: true } },
                        _count: { select: { sessions: true } },
                    },
                },
            },
        });
        if (!r) throw new NotFoundException({ code: 'credits.not_found', message: 'credits.not_found' });

        const itemIds = r.links.map((l) => l.chapter_item_id);
        const [statsByCredit, itemTitles] = await Promise.all([
            this.listService.computeStats([r.id], [r.group_id]),
            this.listService.resolveChapterItemTitles(itemIds),
        ]);

        const credit = {
            id: r.id,
            title: r.title,
            description: r.description,
            scheduled_at: r.scheduled_at,
            status: r.status,
            course: { id: r.course.id, title: pickTitle(r.course.translations) },
            chapter: { id: r.chapter.id, title: pickTitle(r.chapter.translations) },
            group: { id: r.group.id, name: r.group.name },
            lesson_item_ids: itemIds,
            lessons: itemIds.map((itemId) => ({ chapter_item_id: itemId, title: itemTitles.get(itemId) ?? null })),
            stats: statsByCredit.get(r.id.toString()) ?? { students: 0, passed: 0, failed: 0, pending: 0 },
            launches: r.launches.map((l) => ({
                id: l.id,
                status: l.status,
                curator: { id: l.curator.id, full_name: l.curator.full_name },
                question_count: l.question_count,
                duration_sec: l.duration_sec,
                pass_type: l.pass_type,
                pass_value: l.pass_value,
                session_count: l._count.sessions,
                created_at: l.created_at,
            })),
            created_at: r.created_at,
            updated_at: r.updated_at,
        };

        return apiResponse(1, 'retrieved', 'admin.credits.retrieved', credit);
    }

    public async history(actor: ScopeActor, creditId: bigint, query: CreditHistoryDto) {
        await this.assertCreditVisible(actor, creditId);

        const page = Math.max(1, query.page ?? 1);
        const page_size = Math.min(
            CreditsDetailService.MAX_PAGE_SIZE,
            Math.max(1, query.page_size ?? CreditsDetailService.DEFAULT_PAGE_SIZE),
        );

        const where: any = { credit_id: creditId };
        if (typeof query.student_id === 'number') where.student_id = query.student_id;
        if (query.status) where.status = query.status;

        const [total, raw] = await this.prisma.$transaction([
            this.prisma.creditSession.count({ where }),
            this.prisma.creditSession.findMany({
                where,
                orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
                take: page_size,
                skip: (page - 1) * page_size,
                select: {
                    id: true,
                    launch_id: true,
                    attempt_number: true,
                    started_at: true,
                    finished_at: true,
                    score: true,
                    max_score: true,
                    status: true,
                    passed: true,
                    retake_at: true,
                    student: { select: { id: true, full_name: true } },
                },
            }),
        ]);

        const rows: CreditHistoryRow[] = raw.map((s) => ({
            session_id: s.id,
            launch_id: s.launch_id,
            student: { id: s.student.id, full_name: s.student.full_name },
            attempt_number: s.attempt_number,
            started_at: s.started_at,
            finished_at: s.finished_at,
            score: s.score,
            max_score: s.max_score,
            percent: s.score == null ? null : computePercent(s.score, s.max_score),
            status: s.status,
            passed: s.passed,
            retake_at: s.retake_at,
        }));

        return { rows, total, pageCount: Math.max(1, Math.ceil(total / page_size)) };
    }

    /**
     * Wizard student picker source: current group members with pass/attempt state.
     * attempts_used counts non-cancelled sessions (mirrors attempt_number allocation).
     */
    public async eligibleStudents(actor: ScopeActor, creditId: bigint) {
        const credit = await this.assertCreditVisible(actor, creditId);

        const [members, sessions] = await Promise.all([
            this.prisma.groupUser.findMany({
                where: { group_id: credit.group_id },
                select: { user: { select: { id: true, full_name: true, email: true } } },
                orderBy: { user_id: 'asc' },
            }),
            this.prisma.creditSession.findMany({
                where: { credit_id: creditId },
                select: { id: true, student_id: true, status: true, passed: true },
            }),
        ]);

        const passedSet = new Set<number>();
        const attemptCount = new Map<number, number>();
        const activeSession = new Map<number, bigint>();
        for (const s of sessions) {
            if (s.passed === true) passedSet.add(s.student_id);
            if (s.status !== 'cancelled') attemptCount.set(s.student_id, (attemptCount.get(s.student_id) ?? 0) + 1);
            if (s.status === 'pending' || s.status === 'in_progress') activeSession.set(s.student_id, s.id);
        }

        const students: EligibleStudent[] = members.map((m) => ({
            id: m.user.id,
            full_name: m.user.full_name,
            email: m.user.email,
            passed: passedSet.has(m.user.id),
            attempts_used: attemptCount.get(m.user.id) ?? 0,
            active_session_id: activeSession.get(m.user.id) ?? null,
        }));

        return apiResponse(1, 'retrieved', 'admin.credits.eligible_students_retrieved', { students });
    }

    private async assertCreditVisible(actor: ScopeActor, creditId: bigint) {
        const credit = await this.prisma.credit.findFirst({
            where: { id: creditId, deleted_at: null, ...(buildScopeWhere(actor, CREDIT_SCOPE_RULES) as object) },
            select: { id: true, group_id: true },
        });
        if (!credit) throw new NotFoundException({ code: 'credits.not_found', message: 'credits.not_found' });
        return credit;
    }
}

function pickTitle(translations: Array<{ locale: string; title: string | null }> | undefined): string | null {
    if (!translations || translations.length === 0) return null;
    return (
        translations.find((t) => t.locale === 'kz')?.title ??
        translations.find((t) => t.locale === 'ru')?.title ??
        translations[0]?.title ??
        null
    );
}
