import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { buildScopeWhere } from '../../common/scoping/scope.helper';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { CREDIT_SESSION_SCOPE_RULES } from './credits.scope';
import { ListCreditResultsDto } from './dto/list-credit-results.dto';
import type { CreditResultRow } from './types/credits.types';
import { computePercent } from './utils/finalize';

/**
 * Cross-credit results (item 9): every conducted «зачёт» attempt across ALL
 * credits, searchable by student ФИО or phone «номер». Read-only aggregation over
 * credit_sessions joined to credits (title/course/group) and users (name/mobile).
 *
 * Scope: reuses CREDIT_SESSION_SCOPE_RULES (admin → all, curator → own groups,
 * teacher → fail-closed). Permission: credits.results_view (same as per-credit
 * history). Default status filter is the finalized set (finished + expired) so
 * the page shows real results, not pending/cancelled shells.
 */
@Injectable()
export class CreditsResultsService {
    private static readonly DEFAULT_PAGE_SIZE = 50;
    private static readonly MAX_PAGE_SIZE = 200;

    constructor(private readonly prisma: PrismaService) {}

    public async listAll(actor: ScopeActor, query: ListCreditResultsDto) {
        const page = Math.max(1, query.page ?? 1);
        const page_size = Math.min(
            CreditsResultsService.MAX_PAGE_SIZE,
            Math.max(1, query.page_size ?? CreditsResultsService.DEFAULT_PAGE_SIZE),
        );

        const scopeWhere = buildScopeWhere(actor, CREDIT_SESSION_SCOPE_RULES) as { credit?: object };
        const where: any = { ...scopeWhere };

        // Status: explicit filter, else default to finalized attempts (have a result).
        where.status = query.status ? query.status : { in: ['finished', 'expired'] };
        if (query.passed === 'true') where.passed = true;
        else if (query.passed === 'false') where.passed = false;

        // Date range on finished_at (unix sec).
        if (query.date_from != null || query.date_to != null) {
            where.finished_at = {
                ...(query.date_from != null ? { gte: query.date_from } : {}),
                ...(query.date_to != null ? { lte: query.date_to } : {}),
            };
        }

        // Course / group filters live on the related credit. MERGE onto (never
        // overwrite) the scope's credit fragment so a curator's group scoping
        // survives when they also filter by course/group.
        if (query.course_id != null || query.group_id != null) {
            where.credit = {
                ...(scopeWhere.credit ?? {}),
                ...(query.course_id != null ? { course_id: query.course_id } : {}),
                ...(query.group_id != null ? { group_id: query.group_id } : {}),
            };
        }

        // Search: student ФИО OR phone «номер» (MySQL collation is case-insensitive;
        // Prisma has no `mode: insensitive` on MySQL).
        const needle = query.search?.trim();
        if (needle) {
            where.student = { OR: [{ full_name: { contains: needle } }, { mobile: { contains: needle } }] };
        }

        const [total, raw] = await this.prisma.$transaction([
            this.prisma.creditSession.count({ where }),
            this.prisma.creditSession.findMany({
                where,
                orderBy: [{ finished_at: 'desc' }, { id: 'desc' }],
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
                    student: { select: { id: true, full_name: true, mobile: true } },
                    credit: {
                        select: {
                            id: true,
                            title: true,
                            group: { select: { id: true, name: true } },
                            course: { select: { id: true, translations: { select: { locale: true, title: true } } } },
                        },
                    },
                },
            }),
        ]);

        const rows: CreditResultRow[] = raw.map((s) => ({
            session_id: s.id,
            launch_id: s.launch_id,
            credit: {
                id: s.credit.id,
                title: s.credit.title,
                course: { id: s.credit.course.id, title: pickTitle(s.credit.course.translations) },
                group: { id: s.credit.group.id, name: s.credit.group.name },
            },
            student: { id: s.student.id, full_name: s.student.full_name, mobile: s.student.mobile ?? null },
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
