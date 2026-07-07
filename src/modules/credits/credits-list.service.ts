import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { apiResponse } from '../../common/utils/api-response';
import { buildScopeWhere } from '../../common/scoping/scope.helper';
import type { ScopeActor } from '../../common/scoping/scope.types';
import { CREDIT_SCOPE_RULES } from './credits.scope';
import { CalendarCreditsDto } from './dto/calendar-credits.dto';
import { ListCreditsDto } from './dto/list-credits.dto';
import type { CreditCalendarEntry, CreditLessonRef, CreditRow, CreditStats } from './types/credits.types';

/**
 * Read surface for Credit rows (contract §credits CRUD).
 *
 *   GET /credits           — paginated list with filters + per-row stats
 *   GET /credits/calendar  — scheduled_at ∈ [from, to] (read-time merge source, decision 14)
 *
 * Stats per row (contract): students = current group member count; passed /
 * failed / pending are PER-STUDENT aggregates over the credit's sessions:
 *   passed  = distinct students with any passed=true session
 *   failed  = distinct students with a finalized (finished|expired) non-passed
 *             session and no passed one
 *   pending = students - passed - failed (clamped ≥ 0)
 */
@Injectable()
export class CreditsListService {
    public static readonly DEFAULT_PAGE_SIZE = 50;
    public static readonly MAX_PAGE_SIZE = 200;

    constructor(private readonly prisma: PrismaService) {}

    public async list(actor: ScopeActor, query: ListCreditsDto) {
        const page = Math.max(1, query.page ?? 1);
        const page_size = Math.min(CreditsListService.MAX_PAGE_SIZE, Math.max(1, query.page_size ?? CreditsListService.DEFAULT_PAGE_SIZE));

        const where: any = { deleted_at: null, ...(buildScopeWhere(actor, CREDIT_SCOPE_RULES) as object) };
        if (typeof query.course_id === 'number') where.course_id = query.course_id;
        if (typeof query.group_id === 'number') where.group_id = query.group_id;
        if (query.status) where.status = query.status;
        if (query.search && query.search.trim().length > 0) where.title = { contains: query.search.trim() };
        if (typeof query.date_from === 'number') where.scheduled_at = { ...(where.scheduled_at ?? {}), gte: query.date_from };
        if (typeof query.date_to === 'number') where.scheduled_at = { ...(where.scheduled_at ?? {}), lte: query.date_to };

        const [total, raw] = await this.prisma.$transaction([
            this.prisma.credit.count({ where }),
            this.prisma.credit.findMany({
                where,
                orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
                take: page_size,
                skip: (page - 1) * page_size,
                select: {
                    id: true,
                    title: true,
                    scheduled_at: true,
                    status: true,
                    created_at: true,
                    group_id: true,
                    course: { select: { id: true, translations: { select: { locale: true, title: true } } } },
                    chapter: { select: { id: true, translations: { select: { locale: true, title: true } } } },
                    group: { select: { id: true, name: true } },
                    links: { select: { chapter_item_id: true } },
                    launches: { select: { created_at: true }, orderBy: { created_at: 'desc' as const }, take: 1 },
                },
            }),
        ]);

        const creditIds = raw.map((r) => r.id);
        const groupIds = Array.from(new Set(raw.map((r) => r.group_id)));
        const itemIds = Array.from(new Set(raw.flatMap((r) => r.links.map((l) => l.chapter_item_id))));

        const [statsByCredit, itemTitles] = await Promise.all([
            this.computeStats(creditIds, groupIds),
            this.resolveChapterItemTitles(itemIds),
        ]);

        const rows: CreditRow[] = raw.map((r) => ({
            id: r.id,
            title: r.title,
            course: { id: r.course.id, title: pickTitle(r.course.translations) },
            chapter: { id: r.chapter.id, title: pickTitle(r.chapter.translations) },
            group: { id: r.group.id, name: r.group.name },
            scheduled_at: r.scheduled_at,
            status: r.status,
            lessons: r.links.map(
                (l): CreditLessonRef => ({ chapter_item_id: l.chapter_item_id, title: itemTitles.get(l.chapter_item_id) ?? null }),
            ),
            stats: statsByCredit.get(r.id.toString()) ?? { students: 0, passed: 0, failed: 0, pending: 0 },
            last_launch_at: r.launches[0]?.created_at ?? null,
            created_at: r.created_at,
        }));

        return { rows, total, pageCount: Math.max(1, Math.ceil(total / page_size)) };
    }

    public async calendar(actor: ScopeActor, query: CalendarCreditsDto) {
        const raw = await this.prisma.credit.findMany({
            where: {
                deleted_at: null,
                scheduled_at: { gte: query.from, lte: query.to },
                ...(buildScopeWhere(actor, CREDIT_SCOPE_RULES) as object),
            },
            orderBy: [{ scheduled_at: 'asc' }, { id: 'asc' }],
            take: 500,
            select: {
                id: true,
                title: true,
                scheduled_at: true,
                status: true,
                group: { select: { id: true, name: true } },
                course: { select: { id: true, translations: { select: { locale: true, title: true } } } },
            },
        });

        const credits: CreditCalendarEntry[] = raw.map((r) => ({
            id: r.id,
            title: r.title,
            scheduled_at: r.scheduled_at!,
            group: { id: r.group.id, name: r.group.name },
            course: { id: r.course.id, title: pickTitle(r.course.translations) },
            status: r.status,
        }));

        return apiResponse(1, 'retrieved', 'admin.credits.calendar_retrieved', { credits });
    }

    // --------------------------------------------------- shared read helpers

    /** Per-credit stats: group member counts + per-student session outcomes (see class doc). */
    public async computeStats(creditIds: bigint[], groupIds: number[]): Promise<Map<string, CreditStats>> {
        const out = new Map<string, CreditStats>();
        if (creditIds.length === 0) return out;

        const [memberCounts, sessions, credits] = await Promise.all([
            groupIds.length === 0
                ? Promise.resolve([] as Array<{ group_id: number; _count: { _all: number } }>)
                : this.prisma.groupUser.groupBy({ by: ['group_id'], where: { group_id: { in: groupIds } }, _count: { _all: true } }),
            this.prisma.creditSession.findMany({
                where: { credit_id: { in: creditIds } },
                select: { credit_id: true, student_id: true, status: true, passed: true },
            }),
            this.prisma.credit.findMany({ where: { id: { in: creditIds } }, select: { id: true, group_id: true } }),
        ]);

        const membersByGroup = new Map<number, number>();
        for (const m of memberCounts) membersByGroup.set(m.group_id, m._count._all);

        const passedByCredit = new Map<string, Set<number>>();
        const failedByCredit = new Map<string, Set<number>>();
        for (const s of sessions) {
            const key = s.credit_id.toString();
            if (s.passed === true) {
                if (!passedByCredit.has(key)) passedByCredit.set(key, new Set());
                passedByCredit.get(key)!.add(s.student_id);
            } else if (s.status === 'finished' || s.status === 'expired') {
                if (!failedByCredit.has(key)) failedByCredit.set(key, new Set());
                failedByCredit.get(key)!.add(s.student_id);
            }
        }

        for (const c of credits) {
            const key = c.id.toString();
            const students = membersByGroup.get(c.group_id) ?? 0;
            const passedSet = passedByCredit.get(key) ?? new Set<number>();
            const failedSet = new Set(Array.from(failedByCredit.get(key) ?? []).filter((id) => !passedSet.has(id)));
            const passed = passedSet.size;
            const failed = failedSet.size;
            out.set(key, { students, passed, failed, pending: Math.max(0, students - passed - failed) });
        }
        return out;
    }

    /**
     * Batch-resolves chapter-item titles (kz preferred, then ru, then any) via the
     * per-type translation tables — mirrors the schedules module resolver.
     */
    public async resolveChapterItemTitles(itemIds: number[]): Promise<Map<number, string | null>> {
        const out = new Map<number, string | null>();
        if (itemIds.length === 0) return out;

        const items = await this.prisma.webinarChapterItem.findMany({
            where: { id: { in: itemIds } },
            select: { id: true, type: true, item_id: true },
        });

        const fileIds = items.filter((i) => i.type === 'file').map((i) => i.item_id);
        const quizIds = items.filter((i) => i.type === 'quiz').map((i) => i.item_id);
        const assignmentIds = items.filter((i) => i.type === 'assignment').map((i) => i.item_id);

        const [files, quizzes, assignments] = await Promise.all([
            fileIds.length === 0
                ? Promise.resolve([] as any[])
                : this.prisma.files.findMany({
                      where: { id: { in: fileIds } },
                      select: { id: true, translations: { select: { locale: true, title: true } } },
                  }),
            quizIds.length === 0
                ? Promise.resolve([] as any[])
                : this.prisma.quizzes.findMany({
                      where: { id: { in: quizIds } },
                      select: { id: true, translations: { select: { locale: true, title: true } } },
                  }),
            assignmentIds.length === 0
                ? Promise.resolve([] as any[])
                : this.prisma.webinarAssignment.findMany({
                      where: { id: { in: assignmentIds } },
                      select: { id: true, translations: { select: { locale: true, title: true } } },
                  }),
        ]);

        const titleByRef = { file: byIdTitle(files), quiz: byIdTitle(quizzes), assignment: byIdTitle(assignments) };
        for (const item of items) {
            out.set(item.id, titleByRef[item.type as 'file' | 'quiz' | 'assignment']?.get(item.item_id) ?? null);
        }
        return out;
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

function byIdTitle(rows: Array<{ id: number; translations: Array<{ locale: string; title: string | null }> }>): Map<number, string | null> {
    const map = new Map<number, string | null>();
    for (const r of rows) map.set(r.id, pickTitle(r.translations));
    return map;
}
